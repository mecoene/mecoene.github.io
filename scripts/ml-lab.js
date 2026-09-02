(() => {
  const root = document.documentElement;
  const $ = (id) => document.getElementById(id);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const palette = ['#e11d48', '#0ea5e9', '#22c55e', '#f59e0b', '#a855f7', '#14b8a6'];

  const getVars = () => {
    const styles = getComputedStyle(root);
    return {
      canvas: styles.getPropertyValue('--canvas-bg').trim() || '#09090a',
      border: styles.getPropertyValue('--border').trim() || '#322127',
      grid: styles.getPropertyValue('--grid-line').trim() || 'rgba(255,255,255,.08)',
      textMuted: styles.getPropertyValue('--text-muted').trim() || '#b8aeb2',
      heading: styles.getPropertyValue('--heading').trim() || '#fff',
      accent: styles.getPropertyValue('--accent').trim() || '#e11d48',
    };
  };

  const canvasPoint = (canvas, event) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const drawCanvasGrid = (ctx, width, height, step) => {
    const vars = getVars();
    ctx.fillStyle = vars.canvas;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = vars.grid;
    ctx.lineWidth = 1;
    for (let x = step; x < width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = step; y < height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  };

  const trafficCanvas = $('trafficCanvas');
  const trafficAutonomy = $('trafficAutonomy');
  const trafficAutonomyValue = $('trafficAutonomyValue');
  const trafficDensity = $('trafficDensity');
  const trafficDensityValue = $('trafficDensityValue');
  const trafficAttack = $('trafficAttack');
  const trafficRecovery = $('trafficRecovery');
  const trafficPause = $('trafficPause');
  const trafficReset = $('trafficReset');
  const trafficStatus = $('trafficStatus');
  const trafficStability = $('trafficStability');
  const trafficThroughput = $('trafficThroughput');
  const trafficNearMisses = $('trafficNearMisses');
  const trafficCollisions = $('trafficCollisions');
  const trafficWidth = trafficCanvas.width;
  const trafficHeight = trafficCanvas.height;
  const trafficCenter = { x: trafficWidth / 2, y: trafficHeight / 2 };
  const trafficLanes = [
    { key: 'east', group: 'ew', axis: 'x', sign: 1, x: -54, y: 270, stop: 302, heading: 0 },
    { key: 'west', group: 'ew', axis: 'x', sign: -1, x: trafficWidth + 54, y: 210, stop: 458, heading: Math.PI },
    { key: 'south', group: 'ns', axis: 'y', sign: 1, x: 350, y: -54, stop: 162, heading: Math.PI / 2 },
    { key: 'north', group: 'ns', axis: 'y', sign: -1, x: 410, y: trafficHeight + 54, stop: 318, heading: -Math.PI / 2 },
  ];
  const trafficState = {
    vehicles: [],
    timers: {},
    pairCooldowns: new Map(),
    nextId: 1,
    time: 0,
    lastFrame: null,
    paused: false,
    poisonId: null,
    emergencyHold: 0,
    throughput: 0,
    nearMisses: 0,
    collisions: 0,
    stability: 100,
  };

  const trafficDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  const trafficDisplayPoint = (vehicle) => (
    vehicle.lane.axis === 'x'
      ? { x: vehicle.x, y: vehicle.y + vehicle.lateral }
      : { x: vehicle.x + vehicle.lateral, y: vehicle.y }
  );

  const trafficVehicleBounds = (vehicle, x = vehicle.x, y = vehicle.y, lateral = vehicle.lateral) => {
    const point = vehicle.lane.axis === 'x'
      ? { x, y: y + lateral }
      : { x: x + lateral, y };
    const halfLength = vehicle.length / 2;
    const halfWidth = vehicle.width / 2;

    return vehicle.lane.axis === 'x'
      ? {
        left: point.x - halfLength,
        right: point.x + halfLength,
        top: point.y - halfWidth,
        bottom: point.y + halfWidth,
      }
      : {
        left: point.x - halfWidth,
        right: point.x + halfWidth,
        top: point.y - halfLength,
        bottom: point.y + halfLength,
      };
  };

  const trafficBoxesTouch = (first, second) => (
    first.left <= second.right
    && first.right >= second.left
    && first.top <= second.bottom
    && first.bottom >= second.top
  );

  const trafficCenterDistance = (vehicle) => trafficDistance(trafficDisplayPoint(vehicle), trafficCenter);

  const trafficSignalGreen = (lane) => {
    if (trafficState.emergencyHold > 0) return false;
    const phase = trafficState.time % 10;
    if (lane.group === 'ew') return phase < 4.6;
    return phase >= 5 && phase < 9.6;
  };

  const trafficSignalLabel = (lane) => {
    if (trafficState.emergencyHold > 0) return 'hold';
    const phase = trafficState.time % 10;
    const amber = lane.group === 'ew' ? phase >= 4.6 && phase < 5 : phase >= 9.6;
    if (amber) return 'amber';
    return trafficSignalGreen(lane) ? 'green' : 'red';
  };

  const trafficStopDistance = (vehicle) => {
    const lane = vehicle.lane;
    const front = lane.axis === 'x'
      ? vehicle.x + lane.sign * vehicle.length * 0.5
      : vehicle.y + lane.sign * vehicle.length * 0.5;
    return lane.sign > 0 ? lane.stop - front : front - lane.stop;
  };

  const trafficPassedStop = (vehicle) => trafficStopDistance(vehicle) < -16;

  const trafficInsideIntersection = (vehicle) => {
    const point = trafficDisplayPoint(vehicle);
    return point.x > 304 && point.x < 456 && point.y > 164 && point.y < 316;
  };

  const trafficCanSpawn = (lane) => !trafficState.vehicles.some((vehicle) => (
    vehicle.lane.key === lane.key
    && !vehicle.collided
    && (lane.axis === 'x'
      ? Math.abs(vehicle.x - lane.x) < 96
      : Math.abs(vehicle.y - lane.y) < 96)
  ));

  const makeTrafficVehicle = (lane) => {
    const autonomous = Math.random() * 100 < Number(trafficAutonomy.value);
    return {
      id: trafficState.nextId,
      lane,
      x: lane.x,
      y: lane.y,
      lateral: 0,
      speed: 34 + Math.random() * 18,
      command: 60,
      baseSpeed: autonomous ? 88 + Math.random() * 10 : 72 + Math.random() * 22,
      type: autonomous ? 'av' : 'human',
      length: 32,
      width: 17,
      aggression: autonomous ? 0.14 : 0.38 + Math.random() * 0.58,
      wait: 0,
      poisoned: false,
      collided: false,
      crashTimer: 0,
    };
  };

  const pickPoisonedVehicle = () => {
    const attack = trafficAttack.value;
    if (attack === 'none') {
      trafficState.poisonId = null;
      trafficState.vehicles.forEach((vehicle) => {
        vehicle.poisoned = false;
      });
      return null;
    }

    const current = trafficState.vehicles.find((vehicle) => vehicle.id === trafficState.poisonId && !vehicle.collided);
    if (current) return current;

    const moving = trafficState.vehicles.filter((vehicle) => !vehicle.collided && trafficCenterDistance(vehicle) < 290);
    const autonomous = moving.filter((vehicle) => vehicle.type === 'av');
    const candidates = autonomous.length ? autonomous : moving;
    if (!candidates.length) return null;

    const poisoned = candidates[Math.floor(Math.random() * candidates.length)];
    trafficState.poisonId = poisoned.id;
    trafficState.vehicles.forEach((vehicle) => {
      vehicle.poisoned = vehicle.id === poisoned.id;
    });
    return poisoned;
  };

  const resetTraffic = () => {
    trafficState.vehicles = [];
    trafficState.timers = {};
    trafficState.pairCooldowns.clear();
    trafficState.nextId = 1;
    trafficState.time = 0;
    trafficState.lastFrame = null;
    trafficState.poisonId = null;
    trafficState.emergencyHold = 0;
    trafficState.throughput = 0;
    trafficState.nearMisses = 0;
    trafficState.collisions = 0;
    trafficState.stability = 100;
    trafficLanes.forEach((lane, index) => {
      trafficState.timers[lane.key] = index * 0.35;
    });
  };

  const spawnTraffic = (dt) => {
    const density = Number(trafficDensity.value) / 100;
    const baseInterval = 2.45 - density * 1.55;
    trafficLanes.forEach((lane) => {
      trafficState.timers[lane.key] -= dt;
      if (trafficState.timers[lane.key] > 0) return;
      if (trafficCanSpawn(lane)) {
        trafficState.vehicles.push(makeTrafficVehicle(lane));
        trafficState.nextId += 1;
      }
      trafficState.timers[lane.key] = baseInterval * (0.78 + Math.random() * 0.68);
    });
  };

  const trafficLeaderGap = (vehicle) => {
    let nearest = Infinity;
    trafficState.vehicles.forEach((other) => {
      if (other === vehicle || other.lane.key !== vehicle.lane.key) return;
      const delta = vehicle.lane.axis === 'x'
        ? (other.x - vehicle.x) * vehicle.lane.sign
        : (other.y - vehicle.y) * vehicle.lane.sign;
      if (delta > 0) nearest = Math.min(nearest, delta - vehicle.length);
    });
    return nearest;
  };

  const applyTrafficRecovery = (vehicle, targetSpeed, poisoned) => {
    const mode = trafficRecovery.value;
    if (mode === 'none' || !poisoned || vehicle.poisoned) return targetSpeed;

    const distance = trafficDistance(trafficDisplayPoint(vehicle), trafficDisplayPoint(poisoned));
    const poisonedActive = trafficCenterDistance(poisoned) < 190 || trafficInsideIntersection(poisoned);
    if (mode === 'hold' && poisonedActive) {
      trafficState.emergencyHold = Math.max(trafficState.emergencyHold, 0.85);
      if (!trafficPassedStop(vehicle) && trafficStopDistance(vehicle) < 185) return 0;
    }

    if (mode === 'cooperative') {
      if (vehicle.type === 'av' && (distance < 150 || (poisonedActive && trafficStopDistance(vehicle) < 165))) {
        return Math.min(targetSpeed, Math.max(0, distance - 52) * 0.85);
      }
      if (vehicle.type === 'human' && distance < 88) {
        return Math.min(targetSpeed, 28);
      }
    }

    return targetSpeed;
  };

  const updateTrafficVehicle = (vehicle, dt, poisoned) => {
    if (vehicle.collided) {
      vehicle.crashTimer -= dt;
      return;
    }

    const attack = trafficAttack.value;
    let targetSpeed = vehicle.baseSpeed;
    let lateralTarget = 0;
    const stopDistance = trafficStopDistance(vehicle);
    const obeySignal = !(vehicle.poisoned && attack === 'signal');
    const redSignal = !trafficSignalGreen(vehicle.lane) && !trafficPassedStop(vehicle);

    if (redSignal && obeySignal && stopDistance < 138) {
      const humanRisk = vehicle.type === 'human' && vehicle.aggression > 0.88 && stopDistance < 42;
      if (!humanRisk) targetSpeed = Math.min(targetSpeed, Math.max(0, stopDistance * 1.45));
    }

    const leaderGap = trafficLeaderGap(vehicle);
    if (leaderGap < 92) {
      const gapLimit = vehicle.type === 'av' ? 1.55 : 1.18;
      targetSpeed = Math.min(targetSpeed, Math.max(0, (leaderGap - 20) * gapLimit));
    }

    if (vehicle.poisoned && attack === 'brake' && trafficCenterDistance(vehicle) < 240) {
      targetSpeed = Math.min(targetSpeed, trafficState.time % 1.25 < 0.78 ? 0 : 34);
    }

    if (vehicle.poisoned && attack === 'signal') {
      targetSpeed = Math.max(targetSpeed, 104);
    }

    if (vehicle.poisoned && attack === 'drift' && trafficCenterDistance(vehicle) < 255) {
      lateralTarget = Math.sin(trafficState.time * 4.2 + vehicle.id) * 21;
      targetSpeed = Math.max(targetSpeed, 86);
    }

    targetSpeed = applyTrafficRecovery(vehicle, targetSpeed, poisoned);

    const reaction = vehicle.type === 'av' ? 7.5 : 3.15;
    vehicle.command += (targetSpeed - vehicle.command) * Math.min(1, dt * reaction);
    const accel = vehicle.command > vehicle.speed ? (vehicle.type === 'av' ? 78 : 52) : (vehicle.type === 'av' ? 160 : 92);
    vehicle.speed += clamp(vehicle.command - vehicle.speed, -accel * dt, accel * dt);
    vehicle.speed = Math.max(0, vehicle.speed);
    vehicle.lateral += (lateralTarget - vehicle.lateral) * Math.min(1, dt * 4.5);

    let moveDistance = vehicle.speed * dt;
    const blockingGap = trafficLeaderGap(vehicle);
    if (Number.isFinite(blockingGap)) {
      const maxMove = Math.max(0, blockingGap - 0.75);
      if (moveDistance > maxMove) {
        moveDistance = maxMove;
        vehicle.speed = maxMove / Math.max(dt, 0.001);
        vehicle.command = Math.min(vehicle.command, vehicle.speed);
      }
    }

    const signedDistance = moveDistance * vehicle.lane.sign;
    if (vehicle.lane.axis === 'x') vehicle.x += signedDistance;
    else vehicle.y += signedDistance;
    if (vehicle.speed < 6 && targetSpeed < 12) vehicle.wait += dt;
  };

  const markTrafficCollision = (first, second, key) => {
    trafficState.collisions += 1;
    first.collided = true;
    second.collided = true;
    first.crashTimer = Math.max(first.crashTimer, 1.35);
    second.crashTimer = Math.max(second.crashTimer, 1.35);
    first.speed = 0;
    second.speed = 0;
    first.command = 0;
    second.command = 0;
    trafficState.emergencyHold = Math.max(trafficState.emergencyHold, 1.25);
    trafficState.pairCooldowns.set(key, 1.8);
  };

  const updateTrafficInteractions = (dt) => {
    trafficState.pairCooldowns.forEach((time, key) => {
      const next = time - dt;
      if (next <= 0) trafficState.pairCooldowns.delete(key);
      else trafficState.pairCooldowns.set(key, next);
    });

    for (let i = 0; i < trafficState.vehicles.length; i += 1) {
      const first = trafficState.vehicles[i];
      const firstPoint = trafficDisplayPoint(first);
      const firstBounds = trafficVehicleBounds(first);

      for (let j = i + 1; j < trafficState.vehicles.length; j += 1) {
        const second = trafficState.vehicles[j];
        const secondPoint = trafficDisplayPoint(second);
        const secondBounds = trafficVehicleBounds(second);
        const touching = trafficBoxesTouch(firstBounds, secondBounds);
        const distance = trafficDistance(firstPoint, secondPoint);
        if (!touching && distance > 48) continue;

        const key = first.id < second.id ? `${first.id}-${second.id}` : `${second.id}-${first.id}`;
        const crossing = first.lane.group !== second.lane.group;
        const closeFollowing = first.lane.key === second.lane.key && distance < 28;
        const alreadyCrashedPair = first.collided && second.collided;
        const crashing = touching || distance < 20 || (crossing && distance < 24);

        if (crashing && !alreadyCrashedPair) {
          markTrafficCollision(first, second, key);
          continue;
        }

        if (alreadyCrashedPair || first.collided || second.collided || trafficState.pairCooldowns.has(key)) continue;
        if (crossing || closeFollowing) {
          trafficState.nearMisses += 1;
          if (trafficRecovery.value === 'hold') trafficState.emergencyHold = Math.max(trafficState.emergencyHold, 0.75);
          trafficState.pairCooldowns.set(key, 1.45);
        }
      }
    }
  };

  const vehicleHasExited = (vehicle) => (
    vehicle.lane.axis === 'x'
      ? (vehicle.lane.sign > 0 ? vehicle.x > trafficWidth + 62 : vehicle.x < -62)
      : (vehicle.lane.sign > 0 ? vehicle.y > trafficHeight + 62 : vehicle.y < -62)
  );

  const updateTrafficMetrics = () => {
    const waitPenalty = trafficState.vehicles.reduce((sum, vehicle) => sum + Math.min(vehicle.wait, 7), 0) * 0.82;
    const activePenalty = Math.max(0, trafficState.vehicles.length - 10) * 0.55;
    const score = 100 - trafficState.collisions * 17 - trafficState.nearMisses * 2.8 - waitPenalty - activePenalty;
    trafficState.stability = Math.round(clamp(score, 0, 100));

    trafficAutonomyValue.value = `${trafficAutonomy.value}%`;
    trafficDensityValue.value = `${trafficDensity.value}%`;
    trafficStability.textContent = `${trafficState.stability}%`;
    trafficThroughput.textContent = String(trafficState.throughput);
    trafficNearMisses.textContent = String(trafficState.nearMisses);
    trafficCollisions.textContent = String(trafficState.collisions);

    if (trafficState.paused) {
      trafficStatus.textContent = 'Paused';
    } else if (trafficAttack.value === 'none') {
      trafficStatus.textContent = 'Stable flow';
    } else if (trafficRecovery.value === 'none') {
      trafficStatus.textContent = 'Attack destabilizing';
    } else {
      trafficStatus.textContent = trafficState.stability < 58 ? 'Recovering control' : 'Recovery active';
    }
  };

  const stepTraffic = (dt) => {
    trafficState.time += dt;
    trafficState.emergencyHold = Math.max(0, trafficState.emergencyHold - dt);
    spawnTraffic(dt);
    const poisoned = pickPoisonedVehicle();
    trafficState.vehicles.forEach((vehicle) => updateTrafficVehicle(vehicle, dt, poisoned));
    updateTrafficInteractions(dt);
    trafficState.vehicles = trafficState.vehicles.filter((vehicle) => {
      if (vehicle.collided) return vehicle.crashTimer > 0;
      if (vehicleHasExited(vehicle)) {
        trafficState.throughput += 1;
        if (vehicle.id === trafficState.poisonId) trafficState.poisonId = null;
        return false;
      }
      return true;
    });
    updateTrafficMetrics();
  };

  const roundedRect = (ctx, x, y, width, height, radius) => {
    const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  };

  const drawTrafficRoads = (ctx, vars) => {
    const isLight = root.dataset.theme === 'light';
    const road = isLight ? '#f1f2f4' : '#151518';
    const roadEdge = isLight ? '#d6d7dc' : '#29242a';
    const laneLine = isLight ? 'rgba(17, 17, 17, .22)' : 'rgba(255, 255, 255, .18)';

    drawCanvasGrid(ctx, trafficWidth, trafficHeight, 38);
    ctx.fillStyle = road;
    ctx.fillRect(0, 174, trafficWidth, 132);
    ctx.fillRect(314, 0, 132, trafficHeight);
    ctx.strokeStyle = roadEdge;
    ctx.lineWidth = 1;
    ctx.strokeRect(-1, 174, trafficWidth + 2, 132);
    ctx.strokeRect(314, -1, 132, trafficHeight + 2);

    ctx.fillStyle = isLight ? '#fff' : '#111113';
    ctx.fillRect(314, 174, 132, 132);
    ctx.strokeStyle = vars.border;
    ctx.strokeRect(314, 174, 132, 132);

    ctx.save();
    ctx.setLineDash([18, 14]);
    ctx.strokeStyle = laneLine;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, trafficCenter.y);
    ctx.lineTo(314, trafficCenter.y);
    ctx.moveTo(446, trafficCenter.y);
    ctx.lineTo(trafficWidth, trafficCenter.y);
    ctx.moveTo(trafficCenter.x, 0);
    ctx.lineTo(trafficCenter.x, 174);
    ctx.moveTo(trafficCenter.x, 306);
    ctx.lineTo(trafficCenter.x, trafficHeight);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = vars.accent;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 2;
    [[302, 174, 302, 306], [458, 174, 458, 306], [314, 162, 446, 162], [314, 318, 446, 318]].forEach((line) => {
      ctx.beginPath();
      ctx.moveTo(line[0], line[1]);
      ctx.lineTo(line[2], line[3]);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;

    ctx.fillStyle = laneLine;
    for (let offset = -36; offset <= 36; offset += 18) {
      ctx.fillRect(292, 184 + offset + 58, 4, 9);
      ctx.fillRect(464, 184 + offset + 58, 4, 9);
      ctx.fillRect(324 + offset + 58, 152, 9, 4);
      ctx.fillRect(324 + offset + 58, 324, 9, 4);
    }
  };

  const drawTrafficLight = (ctx, x, y, label) => {
    const color = label === 'green' ? '#22c55e' : label === 'amber' ? '#f59e0b' : '#e11d48';
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    roundedRect(ctx, x - 9, y - 9, 18, 18, 5);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 5.6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.restore();
  };

  const drawTrafficVehicle = (ctx, vehicle, vars) => {
    const point = trafficDisplayPoint(vehicle);
    const isAv = vehicle.type === 'av';
    const baseColor = vehicle.poisoned ? '#fb365f' : isAv ? '#38bdf8' : vars.textMuted;
    const trimColor = vehicle.poisoned ? '#fff1f2' : isAv ? '#083344' : vars.canvas;

    if (isAv && !vehicle.collided) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(point.x, point.y, vehicle.poisoned ? 50 : 34, 0, Math.PI * 2);
      ctx.strokeStyle = vehicle.poisoned ? 'rgba(251, 54, 95, .28)' : 'rgba(56, 189, 248, .18)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    if (vehicle.poisoned) {
      ctx.save();
      const pulse = 42 + Math.sin(trafficState.time * 6) * 7;
      ctx.beginPath();
      ctx.arc(point.x, point.y, pulse, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(251, 54, 95, .34)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(vehicle.lane.heading);
    ctx.fillStyle = baseColor;
    ctx.strokeStyle = vehicle.collided ? '#fff' : 'rgba(0,0,0,.28)';
    ctx.lineWidth = vehicle.poisoned ? 2.5 : 1.4;
    roundedRect(ctx, -vehicle.length / 2, -vehicle.width / 2, vehicle.length, vehicle.width, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = trimColor;
    roundedRect(ctx, 2, -vehicle.width / 2 + 3, 8, vehicle.width - 6, 2);
    ctx.fill();
    ctx.fillStyle = vehicle.poisoned ? '#070708' : '#fff';
    ctx.font = '8px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(vehicle.poisoned ? '!' : isAv ? 'A' : 'H', -4, 0);

    if (vehicle.collided) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-10, -7);
      ctx.lineTo(10, 7);
      ctx.moveTo(10, -7);
      ctx.lineTo(-10, 7);
      ctx.stroke();
    }
    ctx.restore();
  };

  const drawTraffic = () => {
    const ctx = trafficCanvas.getContext('2d');
    const vars = getVars();
    drawTrafficRoads(ctx, vars);

    const ew = trafficSignalLabel(trafficLanes[0]);
    const ns = trafficSignalLabel(trafficLanes[2]);
    drawTrafficLight(ctx, 292, 322, ew);
    drawTrafficLight(ctx, 468, 158, ew);
    drawTrafficLight(ctx, 294, 158, ns);
    drawTrafficLight(ctx, 468, 322, ns);

    const poisoned = trafficState.vehicles.find((vehicle) => vehicle.poisoned && !vehicle.collided);
    if (poisoned && trafficRecovery.value === 'cooperative') {
      const point = trafficDisplayPoint(poisoned);
      ctx.save();
      ctx.beginPath();
      ctx.arc(point.x, point.y, 124, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(56, 189, 248, .22)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 8]);
      ctx.stroke();
      ctx.restore();
    }

    if (trafficState.emergencyHold > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(225, 29, 72, .12)';
      ctx.fillRect(314, 174, 132, 132);
      ctx.strokeStyle = 'rgba(251, 54, 95, .5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(314, 174, 132, 132);
      ctx.restore();
    }

    trafficState.vehicles.forEach((vehicle) => drawTrafficVehicle(ctx, vehicle, vars));
  };

  const runTrafficFrame = (now) => {
    if (trafficState.lastFrame === null) trafficState.lastFrame = now;
    const dt = Math.min((now - trafficState.lastFrame) / 1000, 0.05);
    trafficState.lastFrame = now;
    if (!trafficState.paused) stepTraffic(dt);
    drawTraffic();
    requestAnimationFrame(runTrafficFrame);
  };

  const updateTrafficControls = () => {
    trafficAutonomyValue.value = `${trafficAutonomy.value}%`;
    trafficDensityValue.value = `${trafficDensity.value}%`;
  };

  [trafficAutonomy, trafficDensity].forEach((control) => {
    control.addEventListener('input', updateTrafficControls);
    control.addEventListener('change', updateTrafficControls);
  });

  trafficAttack.addEventListener('change', () => {
    trafficState.poisonId = null;
    trafficState.vehicles.forEach((vehicle) => {
      vehicle.poisoned = false;
    });
  });

  trafficPause.addEventListener('click', () => {
    trafficState.paused = !trafficState.paused;
    trafficPause.textContent = trafficState.paused ? 'Resume' : 'Pause';
    updateTrafficMetrics();
    drawTraffic();
  });

  trafficReset.addEventListener('click', () => {
    const wasPaused = trafficState.paused;
    resetTraffic();
    trafficState.paused = wasPaused;
    trafficPause.textContent = trafficState.paused ? 'Resume' : 'Pause';
    updateTrafficMetrics();
    drawTraffic();
  });

  const clusterCanvas = $('clusterCanvas');
  const clusterAlgorithm = $('clusterAlgorithm');
  const clusterK = $('clusterK');
  const clusterKValue = $('clusterKValue');
  const clusterEps = $('clusterEps');
  const clusterEpsValue = $('clusterEpsValue');
  const clusterMin = $('clusterMin');
  const clusterMinValue = $('clusterMinValue');
  const clusterKField = $('clusterKField');
  const clusterEpsField = $('clusterEpsField');
  const clusterMinField = $('clusterMinField');
  const clusterSeed = $('clusterSeed');
  const clusterClear = $('clusterClear');
  const clusterStatus = $('clusterStatus');
  const clusterState = {
    points: [],
    dragging: null,
  };

  const randomNormal = () => {
    const u = 1 - Math.random();
    const v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const seedClusterPoints = () => {
    const centers = [
      { x: 155, y: 130 },
      { x: 420, y: 130 },
      { x: 305, y: 305 },
      { x: 520, y: 300 },
    ];
    clusterState.points = [];
    centers.forEach((center, centerIndex) => {
      const count = centerIndex === 3 ? 8 : 14;
      for (let i = 0; i < count; i += 1) {
        clusterState.points.push({
          x: clamp(center.x + randomNormal() * 34, 18, clusterCanvas.width - 18),
          y: clamp(center.y + randomNormal() * 28, 18, clusterCanvas.height - 18),
        });
      }
    });
    drawClusters();
  };

  const initialCenters = (points, k) => {
    if (!points.length) return [];
    const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
    return Array.from({ length: Math.min(k, points.length) }, (_, index) => {
      const pick = sorted[Math.round((index * (sorted.length - 1)) / Math.max(1, k - 1))];
      return { x: pick.x, y: pick.y };
    });
  };

  const runKMeans = (points, k, iterations = 24) => {
    const centers = initialCenters(points, k);
    const labels = new Array(points.length).fill(0);
    if (!centers.length) return { labels, centers };

    for (let iter = 0; iter < iterations; iter += 1) {
      points.forEach((point, pointIndex) => {
        let best = 0;
        let bestDistance = Infinity;
        centers.forEach((center, centerIndex) => {
          const distance = (point.x - center.x) ** 2 + (point.y - center.y) ** 2;
          if (distance < bestDistance) {
            bestDistance = distance;
            best = centerIndex;
          }
        });
        labels[pointIndex] = best;
      });

      const sums = centers.map(() => ({ x: 0, y: 0, count: 0 }));
      points.forEach((point, pointIndex) => {
        const sum = sums[labels[pointIndex]];
        sum.x += point.x;
        sum.y += point.y;
        sum.count += 1;
      });
      sums.forEach((sum, index) => {
        if (sum.count) {
          centers[index] = { x: sum.x / sum.count, y: sum.y / sum.count };
        }
      });
    }

    return { labels, centers };
  };

  const runGmm = (points, k) => {
    const centers = initialCenters(points, k);
    const labels = new Array(points.length).fill(0);
    if (!centers.length) return { labels, centers };

    const weights = new Array(centers.length).fill(1 / centers.length);
    const variances = new Array(centers.length).fill(2600);
    const responsibilities = points.map(() => new Array(centers.length).fill(0));

    for (let iter = 0; iter < 18; iter += 1) {
      points.forEach((point, pointIndex) => {
        let total = 0;
        centers.forEach((center, centerIndex) => {
          const variance = Math.max(variances[centerIndex], 80);
          const distance = (point.x - center.x) ** 2 + (point.y - center.y) ** 2;
          const score = weights[centerIndex] * Math.exp(-distance / (2 * variance)) / variance;
          responsibilities[pointIndex][centerIndex] = score;
          total += score;
        });
        responsibilities[pointIndex].forEach((score, centerIndex) => {
          responsibilities[pointIndex][centerIndex] = score / Math.max(total, 1e-9);
        });
      });

      centers.forEach((center, centerIndex) => {
        let total = 0;
        let x = 0;
        let y = 0;
        points.forEach((point, pointIndex) => {
          const weight = responsibilities[pointIndex][centerIndex];
          total += weight;
          x += point.x * weight;
          y += point.y * weight;
        });
        if (total > 1e-6) {
          center.x = x / total;
          center.y = y / total;
        }
        weights[centerIndex] = total / points.length;

        let varianceTotal = 0;
        points.forEach((point, pointIndex) => {
          const distance = (point.x - center.x) ** 2 + (point.y - center.y) ** 2;
          varianceTotal += responsibilities[pointIndex][centerIndex] * distance;
        });
        variances[centerIndex] = clamp(varianceTotal / Math.max(total * 2, 1), 90, 12000);
      });
    }

    responsibilities.forEach((row, pointIndex) => {
      labels[pointIndex] = row.reduce((best, value, index) => (value > row[best] ? index : best), 0);
    });

    return { labels, centers, variances };
  };

  const runDbscan = (points, eps, minPoints) => {
    const unvisited = -99;
    const noise = -1;
    const labels = new Array(points.length).fill(unvisited);
    const epsSquared = eps * eps;
    let clusterId = 0;

    const region = (index) => {
      const center = points[index];
      const neighbors = [];
      points.forEach((point, pointIndex) => {
        const distance = (point.x - center.x) ** 2 + (point.y - center.y) ** 2;
        if (distance <= epsSquared) neighbors.push(pointIndex);
      });
      return neighbors;
    };

    points.forEach((_, pointIndex) => {
      if (labels[pointIndex] !== unvisited) return;
      const neighbors = region(pointIndex);
      if (neighbors.length < minPoints) {
        labels[pointIndex] = noise;
        return;
      }

      labels[pointIndex] = clusterId;
      const seedSet = new Set(neighbors);
      const seeds = [...neighbors];
      for (let seedIndex = 0; seedIndex < seeds.length; seedIndex += 1) {
        const neighborIndex = seeds[seedIndex];
        if (labels[neighborIndex] === noise) labels[neighborIndex] = clusterId;
        if (labels[neighborIndex] !== unvisited) continue;

        labels[neighborIndex] = clusterId;
        const expanded = region(neighborIndex);
        if (expanded.length >= minPoints) {
          expanded.forEach((candidate) => {
            if (!seedSet.has(candidate)) {
              seedSet.add(candidate);
              seeds.push(candidate);
            }
          });
        }
      }
      clusterId += 1;
    });

    const centers = Array.from({ length: clusterId }, () => ({ x: 0, y: 0, count: 0 }));
    labels.forEach((label, index) => {
      if (label < 0) return;
      centers[label].x += points[index].x;
      centers[label].y += points[index].y;
      centers[label].count += 1;
    });
    return {
      labels: labels.map((label) => (label === unvisited ? noise : label)),
      centers: centers.map((center) => ({ x: center.x / center.count, y: center.y / center.count })),
    };
  };

  const updateClusterControls = () => {
    const isDbscan = clusterAlgorithm.value === 'dbscan';
    clusterKField.hidden = isDbscan;
    clusterEpsField.hidden = !isDbscan;
    clusterMinField.hidden = !isDbscan;
    clusterKValue.value = clusterK.value;
    clusterEpsValue.value = clusterEps.value;
    clusterMinValue.value = clusterMin.value;
  };

  const clusterResult = () => {
    const points = clusterState.points;
    const k = Number(clusterK.value);
    if (clusterAlgorithm.value === 'dbscan') {
      return runDbscan(points, Number(clusterEps.value), Number(clusterMin.value));
    }
    if (clusterAlgorithm.value === 'gmm') {
      return runGmm(points, k);
    }
    return runKMeans(points, k);
  };

  const drawClusters = () => {
    const ctx = clusterCanvas.getContext('2d');
    const vars = getVars();
    drawCanvasGrid(ctx, clusterCanvas.width, clusterCanvas.height, 32);
    updateClusterControls();

    const result = clusterResult();
    if (clusterAlgorithm.value === 'gmm' && result.variances) {
      result.centers.forEach((center, index) => {
        ctx.beginPath();
        ctx.strokeStyle = palette[index % palette.length];
        ctx.globalAlpha = 0.18;
        ctx.lineWidth = 2;
        ctx.arc(center.x, center.y, Math.sqrt(result.variances[index]) * 1.45, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }

    clusterState.points.forEach((point, index) => {
      const label = result.labels[index] ?? -1;
      ctx.beginPath();
      ctx.fillStyle = label < 0 ? vars.textMuted : palette[label % palette.length];
      ctx.strokeStyle = vars.canvas;
      ctx.lineWidth = 2;
      ctx.arc(point.x, point.y, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    result.centers.forEach((center, index) => {
      if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return;
      ctx.beginPath();
      ctx.fillStyle = vars.heading;
      ctx.strokeStyle = palette[index % palette.length];
      ctx.lineWidth = 3;
      ctx.arc(center.x, center.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    const clusters = new Set(result.labels.filter((label) => label >= 0)).size;
    const noise = result.labels.filter((label) => label < 0).length;
    clusterStatus.textContent = `${clusterState.points.length} points | ${clusters} clusters${noise ? ` | ${noise} noise` : ''}`;
  };

  const nearestClusterPoint = (target) => {
    let nearest = null;
    let bestDistance = 14 ** 2;
    clusterState.points.forEach((point, index) => {
      const distance = (point.x - target.x) ** 2 + (point.y - target.y) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        nearest = index;
      }
    });
    return nearest;
  };

  clusterCanvas.addEventListener('pointerdown', (event) => {
    const point = canvasPoint(clusterCanvas, event);
    const nearest = nearestClusterPoint(point);
    if (nearest === null) {
      clusterState.points.push(point);
      clusterState.dragging = clusterState.points.length - 1;
    } else {
      clusterState.dragging = nearest;
    }
    clusterCanvas.setPointerCapture(event.pointerId);
    drawClusters();
  });

  clusterCanvas.addEventListener('pointermove', (event) => {
    if (clusterState.dragging === null) return;
    const point = canvasPoint(clusterCanvas, event);
    clusterState.points[clusterState.dragging] = {
      x: clamp(point.x, 8, clusterCanvas.width - 8),
      y: clamp(point.y, 8, clusterCanvas.height - 8),
    };
    drawClusters();
  });

  clusterCanvas.addEventListener('pointerup', () => {
    clusterState.dragging = null;
  });

  clusterCanvas.addEventListener('pointercancel', () => {
    clusterState.dragging = null;
  });

  [clusterAlgorithm, clusterK, clusterEps, clusterMin].forEach((control) => {
    control.addEventListener('input', drawClusters);
    control.addEventListener('change', drawClusters);
  });

  clusterSeed.addEventListener('click', seedClusterPoints);
  clusterClear.addEventListener('click', () => {
    clusterState.points = [];
    drawClusters();
  });

  const convSource = $('convSource');
  const convOutput = $('convOutput');
  const convKernel = $('convKernel');
  const convMix = $('convMix');
  const convMixValue = $('convMixValue');
  const convReset = $('convReset');
  const convStatus = $('convStatus');
  const kernelGrid = $('kernelGrid');
  const convSize = 36;
  const convState = {
    grid: new Float32Array(convSize * convSize),
    painting: false,
    customKernel: [0, 0, 0, 0, 1, 0, 0, 0, 0],
  };

  const kernels = {
    blur: {
      matrix: [1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9],
      offset: 0,
    },
    sharpen: {
      matrix: [-1, -1, -1, -1, 9, -1, -1, -1, -1],
      offset: 0,
    },
    edge: {
      matrix: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
      offset: 128,
    },
    sobel: {
      matrix: [-1, 0, 1, -2, 0, 2, -1, 0, 1],
      yMatrix: [-1, -2, -1, 0, 0, 0, 1, 2, 1],
      offset: 0,
    },
    emboss: {
      matrix: [-2, -1, 0, -1, 1, 1, 0, 1, 2],
      offset: 128,
    },
  };

  const activeKernel = () => (
    convKernel.value === 'custom'
      ? { matrix: convState.customKernel, offset: 0 }
      : kernels[convKernel.value]
  );

  const resetConvGrid = () => {
    convState.grid.fill(0);
    drawConvolution();
  };

  const valueFill = (value) => {
    const isLight = root.dataset.theme === 'light';
    const shade = Math.round(isLight ? 255 - value : value);
    return `rgb(${shade}, ${shade}, ${shade})`;
  };

  const drawMatrixCanvas = (canvas, data) => {
    const ctx = canvas.getContext('2d');
    const vars = getVars();
    const cell = canvas.width / convSize;
    ctx.fillStyle = vars.canvas;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < convSize; y += 1) {
      for (let x = 0; x < convSize; x += 1) {
        ctx.fillStyle = valueFill(data[y * convSize + x]);
        ctx.fillRect(Math.floor(x * cell), Math.floor(y * cell), Math.ceil(cell), Math.ceil(cell));
      }
    }
    ctx.strokeStyle = vars.grid;
    ctx.lineWidth = 1;
    for (let i = 1; i < convSize; i += 1) {
      const pos = Math.round(i * cell);
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, canvas.height);
      ctx.moveTo(0, pos);
      ctx.lineTo(canvas.width, pos);
      ctx.stroke();
    }
  };

  const convolve = () => {
    const kernel = activeKernel();
    const output = new Float32Array(convState.grid.length);
    const mix = Number(convMix.value) / 100;

    for (let y = 0; y < convSize; y += 1) {
      for (let x = 0; x < convSize; x += 1) {
        let total = 0;
        let totalY = 0;
        for (let ky = -1; ky <= 1; ky += 1) {
          for (let kx = -1; kx <= 1; kx += 1) {
            const px = clamp(x + kx, 0, convSize - 1);
            const py = clamp(y + ky, 0, convSize - 1);
            const value = convState.grid[py * convSize + px];
            const kernelIndex = (ky + 1) * 3 + (kx + 1);
            total += value * kernel.matrix[kernelIndex];
            if (kernel.yMatrix) totalY += value * kernel.yMatrix[kernelIndex];
          }
        }
        const processed = kernel.yMatrix ? Math.hypot(total, totalY) : total + kernel.offset;
        const original = convState.grid[y * convSize + x];
        output[y * convSize + x] = clamp(original * (1 - mix) + processed * mix, 0, 255);
      }
    }

    return output;
  };

  const formatKernelCell = (value) => {
    if (Math.abs(value - 1 / 9) < 0.001) return '1/9';
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(2);
  };

  const renderKernelGrid = () => {
    const kernel = activeKernel();
    kernelGrid.innerHTML = '';
    kernel.matrix.forEach((value) => {
      const cell = document.createElement('div');
      cell.className = 'kernel-cell';
      if (convKernel.value === 'custom') {
        const input = document.createElement('input');
        input.className = 'kernel-input';
        input.type = 'number';
        input.step = '0.25';
        input.value = String(value);
        input.setAttribute('aria-label', `Kernel value ${kernelGrid.children.length + 1}`);
        input.addEventListener('input', () => {
          const nextValue = Number.parseFloat(input.value);
          convState.customKernel[Number(input.dataset.index)] = Number.isFinite(nextValue) ? nextValue : 0;
          drawConvolution();
        });
        input.dataset.index = String(kernelGrid.children.length);
        cell.appendChild(input);
      } else {
        cell.textContent = formatKernelCell(value);
      }
      kernelGrid.appendChild(cell);
    });
  };

  const drawConvolution = () => {
    convMixValue.value = `${convMix.value}%`;
    drawMatrixCanvas(convSource, convState.grid);
    drawMatrixCanvas(convOutput, convolve());
    convStatus.textContent = convKernel.value === 'sobel' ? 'Sobel X/Y' : convKernel.value === 'custom' ? 'Custom 3x3' : '3x3 kernel';
  };

  const setConvCell = (x, y, value) => {
    if (x < 0 || x >= convSize || y < 0 || y >= convSize) return;
    const index = y * convSize + x;
    convState.grid[index] = value > convState.grid[index] ? value : convState.grid[index];
  };

  const paintConvCell = (event) => {
    const point = canvasPoint(convSource, event);
    const x = clamp(Math.floor(point.x / (convSource.width / convSize)), 0, convSize - 1);
    const y = clamp(Math.floor(point.y / (convSource.height / convSize)), 0, convSize - 1);
    if (event.shiftKey) {
      for (let yy = -1; yy <= 1; yy += 1) {
        for (let xx = -1; xx <= 1; xx += 1) {
          if (x + xx >= 0 && x + xx < convSize && y + yy >= 0 && y + yy < convSize) {
            convState.grid[(y + yy) * convSize + x + xx] = 0;
          }
        }
      }
    } else {
      setConvCell(x, y, 255);
      setConvCell(x - 1, y, 150);
      setConvCell(x + 1, y, 150);
      setConvCell(x, y - 1, 150);
      setConvCell(x, y + 1, 150);
      setConvCell(x - 1, y - 1, 75);
      setConvCell(x + 1, y - 1, 75);
      setConvCell(x - 1, y + 1, 75);
      setConvCell(x + 1, y + 1, 75);
    }
    drawConvolution();
  };

  convSource.addEventListener('pointerdown', (event) => {
    convState.painting = true;
    convSource.setPointerCapture(event.pointerId);
    paintConvCell(event);
  });

  convSource.addEventListener('pointermove', (event) => {
    if (convState.painting) paintConvCell(event);
  });

  convSource.addEventListener('pointerup', () => {
    convState.painting = false;
  });

  convSource.addEventListener('pointercancel', () => {
    convState.painting = false;
  });

  convKernel.addEventListener('change', () => {
    renderKernelGrid();
    drawConvolution();
  });
  convMix.addEventListener('input', drawConvolution);
  convMix.addEventListener('change', drawConvolution);
  convReset.addEventListener('click', resetConvGrid);

  const knnSource = $('knnSource');
  const knnOutput = $('knnOutput');
  const knnUpload = $('knnUpload');
  const knnNeighbors = $('knnNeighbors');
  const knnValue = $('knnValue');
  const knnScale = $('knnScale');
  const knnDownload = $('knnDownload');
  const knnStatus = $('knnStatus');
  const maxKnnSide = 400;
  const knnOffsetCache = new Map();
  const knnState = {
    imageData: null,
    width: 96,
    height: 96,
    label: 'Image',
    pending: false,
  };

  const putImageData = (canvas, imageData) => {
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.putImageData(imageData, 0, 0);
  };

  const safeFileLabel = (label) => (
    label
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'image'
  );

  const downloadCanvasPng = (canvas, filename) => {
    const link = document.createElement('a');
    link.download = filename;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      link.href = url;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }, 'image/png');
  };

  const dctSource = $('dctSource');
  const dctOutput = $('dctOutput');
  const dctUpload = $('dctUpload');
  const dctKeep = $('dctKeep');
  const dctKeepValue = $('dctKeepValue');
  const dctMode = $('dctMode');
  const dctDownload = $('dctDownload');
  const dctStatus = $('dctStatus');
  const maxDctSide = 400;
  const dctSize = 8;
  const dctAlpha = Array.from({ length: dctSize }, (_, index) => (index === 0 ? Math.SQRT1_2 : 1));
  const dctCos = Array.from({ length: dctSize }, (_, u) => (
    Array.from({ length: dctSize }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / 16))
  ));
  const dctZigZag = (() => {
    const order = [];
    for (let sum = 0; sum <= 14; sum += 1) {
      if (sum % 2 === 0) {
        for (let y = Math.min(sum, 7); y >= Math.max(0, sum - 7); y -= 1) {
          order.push(y * 8 + (sum - y));
        }
      } else {
        for (let x = Math.min(sum, 7); x >= Math.max(0, sum - 7); x -= 1) {
          order.push((sum - x) * 8 + x);
        }
      }
    }
    return order;
  })();
  const dctMasks = Array.from({ length: 65 }, (_, keep) => {
    const mask = new Uint8Array(64);
    dctZigZag.slice(0, Math.max(1, keep)).forEach((index) => {
      mask[index] = 1;
    });
    return mask;
  });
  const dctState = {
    imageData: null,
    width: 192,
    height: 128,
    label: 'Image',
    pending: false,
    reconstruction: null,
    error: null,
  };

  const setDctImage = (image, label) => {
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const ratio = Math.min(1, maxDctSide / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * ratio));
    const height = Math.max(1, Math.round(sourceHeight * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, width, height);
    dctState.imageData = ctx.getImageData(0, 0, width, height);
    dctState.width = width;
    dctState.height = height;
    dctState.label = ratio < 1 ? `${label} capped` : label;
    dctDownload.disabled = false;
    renderDct();
  };

  const compressDct = (source, keep) => {
    const width = source.width;
    const height = source.height;
    const src = source.data;
    const output = new ImageData(width, height);
    const error = new ImageData(width, height);
    const out = output.data;
    const err = error.data;
    const mask = dctMasks[keep];
    const block = new Float32Array(64);
    const row = new Float32Array(64);
    const coeff = new Float32Array(64);
    const temp = new Float32Array(64);

    for (let by = 0; by < height; by += 8) {
      for (let bx = 0; bx < width; bx += 8) {
        for (let channel = 0; channel < 3; channel += 1) {
          for (let y = 0; y < 8; y += 1) {
            const py = clamp(by + y, 0, height - 1);
            for (let x = 0; x < 8; x += 1) {
              const px = clamp(bx + x, 0, width - 1);
              block[y * 8 + x] = src[(py * width + px) * 4 + channel] - 128;
            }
          }

          for (let y = 0; y < 8; y += 1) {
            for (let u = 0; u < 8; u += 1) {
              let total = 0;
              for (let x = 0; x < 8; x += 1) {
                total += block[y * 8 + x] * dctCos[u][x];
              }
              row[y * 8 + u] = 0.5 * dctAlpha[u] * total;
            }
          }

          for (let v = 0; v < 8; v += 1) {
            for (let u = 0; u < 8; u += 1) {
              let total = 0;
              for (let y = 0; y < 8; y += 1) {
                total += row[y * 8 + u] * dctCos[v][y];
              }
              const index = v * 8 + u;
              coeff[index] = mask[index] ? 0.5 * dctAlpha[v] * total : 0;
            }
          }

          for (let y = 0; y < 8; y += 1) {
            for (let u = 0; u < 8; u += 1) {
              let total = 0;
              for (let v = 0; v < 8; v += 1) {
                total += dctAlpha[v] * coeff[v * 8 + u] * dctCos[v][y];
              }
              temp[y * 8 + u] = 0.5 * total;
            }
          }

          for (let y = 0; y < 8; y += 1) {
            const py = by + y;
            if (py >= height) continue;
            for (let x = 0; x < 8; x += 1) {
              const px = bx + x;
              if (px >= width) continue;
              let total = 0;
              for (let u = 0; u < 8; u += 1) {
                total += dctAlpha[u] * temp[y * 8 + u] * dctCos[u][x];
              }
              out[(py * width + px) * 4 + channel] = clamp(0.5 * total + 128, 0, 255);
            }
          }
        }

        for (let y = 0; y < 8; y += 1) {
          const py = by + y;
          if (py >= height) continue;
          for (let x = 0; x < 8; x += 1) {
            const px = bx + x;
            if (px >= width) continue;
            const index = (py * width + px) * 4;
            out[index + 3] = src[index + 3];
          }
        }
      }
    }

    for (let index = 0; index < src.length; index += 4) {
      const diff = (
        Math.abs(src[index] - out[index]) +
        Math.abs(src[index + 1] - out[index + 1]) +
        Math.abs(src[index + 2] - out[index + 2])
      ) / 3;
      const heat = clamp(diff * 4.2, 0, 255);
      err[index] = heat;
      err[index + 1] = clamp(24 + diff * 0.35, 0, 120);
      err[index + 2] = clamp(60 + diff * 0.9, 0, 255);
      err[index + 3] = 255;
    }

    return { reconstruction: output, error };
  };

  const renderDct = () => {
    const keep = Number(dctKeep.value);
    dctKeepValue.value = `${keep}/64`;
    if (!dctState.imageData) return;
    const result = compressDct(dctState.imageData, keep);
    dctState.reconstruction = result.reconstruction;
    dctState.error = result.error;
    putImageData(dctSource, dctState.imageData);
    putImageData(dctOutput, dctMode.value === 'error' ? dctState.error : dctState.reconstruction);
    const percent = Math.round((keep / 64) * 100);
    dctStatus.textContent = `${dctState.label} | ${dctState.width}x${dctState.height} | ${keep}/64 coeffs (${percent}%)`;
  };

  const scheduleDct = () => {
    if (dctState.pending) return;
    dctState.pending = true;
    requestAnimationFrame(() => {
      dctState.pending = false;
      renderDct();
    });
  };

  dctUpload.addEventListener('change', () => {
    const file = dctUpload.files && dctUpload.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      setDctImage(image, file.name);
      URL.revokeObjectURL(url);
    };
    image.src = url;
  });

  [dctKeep, dctMode].forEach((control) => {
    control.addEventListener('input', scheduleDct);
    control.addEventListener('change', scheduleDct);
  });
  dctDownload.addEventListener('click', () => {
    if (!dctState.reconstruction && !dctState.error) return;
    const mode = dctMode.value === 'error' ? 'error-map' : 'compressed';
    const filename = `dct-${mode}-${safeFileLabel(dctState.label)}-keep${dctKeep.value}.png`;
    downloadCanvasPng(dctOutput, filename);
  });

  const parkingCanvas = $('parkingCanvas');
  const parkingFrontSensor = $('parkingFrontSensor');
  const parkingFrontDct = $('parkingFrontDct');
  const parkingRearSensor = $('parkingRearSensor');
  const parkingRearDct = $('parkingRearDct');
  const parkingMode = $('parkingMode');
  const parkingTrainEpisodes = $('parkingTrainEpisodes');
  const parkingTrainValue = $('parkingTrainValue');
  const parkingSteer = $('parkingSteer');
  const parkingSteerValue = $('parkingSteerValue');
  const parkingThrottle = $('parkingThrottle');
  const parkingThrottleValue = $('parkingThrottleValue');
  const parkingTrain = $('parkingTrain');
  const parkingSuperTight = $('parkingSuperTight');
  const parkingPause = $('parkingPause');
  const parkingReset = $('parkingReset');
  const parkingStatus = $('parkingStatus');
  const parkingReward = $('parkingReward');
  const parkingEpisodeReward = $('parkingEpisodeReward');
  const parkingBestReward = $('parkingBestReward');
  const parkingScenario = $('parkingScenario');
  const parkingDistance = $('parkingDistance');
  const parkingAngle = $('parkingAngle');
  const parkingCollisions = $('parkingCollisions');
  const parkingWidth = parkingCanvas.width;
  const parkingHeight = parkingCanvas.height;
  const parkingCarLength = 66;
  const parkingCarWidth = 32;
  const parkingWheelbase = 48;
  const parkingPovDctBudget = Object.freeze({ keep: 3, total: 24 });
  const parkingAdjustmentMaxMoves = 3;
  const parkingAdjustmentTriggerDistance = 24;
  const parkingAdjustmentTriggerAngle = 0.18;
  const parkingAdjustmentMoveSeconds = 0.54;
  const parkingAdjustmentThrottle = 0.16;
  const parkingCloseParkedY = 112;
  const parkingTarget = { x: 365, y: parkingCloseParkedY, angle: 0 };
  const parkingParkedCars = [];
  const parkingScenarioTypes = [
    { label: 'Easy', gapRange: [212, 238], color: '#22c55e', chance: 0.27 },
    { label: 'Standard', gapRange: [190, 210], color: '#f59e0b', chance: 0.38 },
    { label: 'Tight', gapRange: [176, 188], color: '#fb365f', chance: 0.35 },
    { label: 'Super Tight', gapRange: [88, 96], color: '#dc2626', chance: 0 },
  ];
  const parkingDefaultPolicy = Object.freeze({
    phase1Offset: 129.44,
    phase2Offset: 72.02,
    phase2YOffset: 78.9,
    phase1Steer: -0.32,
    phase1Throttle: -0.5,
    phase2Steer: 0.14,
    phase2Throttle: -0.55,
    finalThrottleGain: 0.024,
    finalMinThrottle: -0.14,
    finalMaxThrottle: 0.29,
    finalAngleGain: 2.03,
    finalYGain: 0.029,
    finalMaxSteer: 0.49,
  });
  const parkingPolicyRanges = {
    phase1Offset: [105, 190],
    phase2Offset: [10, 90],
    phase2YOffset: [18, 96],
    phase1Steer: [-0.6, -0.2],
    phase1Throttle: [-0.62, -0.25],
    phase2Steer: [0.04, 0.48],
    phase2Throttle: [-0.62, -0.22],
    finalThrottleGain: [0.01, 0.034],
    finalMinThrottle: [-0.34, -0.08],
    finalMaxThrottle: [0.08, 0.34],
    finalAngleGain: [0.7, 2.6],
    finalYGain: [0.004, 0.032],
    finalMaxSteer: [0.3, 0.58],
  };
  const cloneParkingPolicy = (policy) => ({ ...policy });
  const randomRange = ([min, max]) => min + Math.random() * (max - min);
  const normalizeParkingPolicy = (policy) => {
    const next = cloneParkingPolicy(policy);
    Object.entries(parkingPolicyRanges).forEach(([key, [min, max]]) => {
      next[key] = clamp(next[key], min, max);
    });
    next.phase2Offset = Math.min(next.phase2Offset, next.phase1Offset - 55);
    return next;
  };
  const sampleParkingPolicy = () => normalizeParkingPolicy(Object.fromEntries(
    Object.entries(parkingPolicyRanges).map(([key, range]) => [key, randomRange(range)]),
  ));
  const mutateParkingPolicy = (policy, intensity = 1) => {
    const next = cloneParkingPolicy(policy);
    Object.entries(parkingPolicyRanges).forEach(([key, [min, max]]) => {
      const span = max - min;
      next[key] += (Math.random() * 2 - 1) * span * 0.2 * intensity;
    });
    return normalizeParkingPolicy(next);
  };
  const parkingState = {
    car: null,
    scenario: null,
    scenarioCount: 0,
    phase: 0,
    adjustment: null,
    reward: 0,
    episodeReward: 0,
    bestReward: null,
    collisions: 0,
    steps: 0,
    episodesTrained: 0,
    trainProgress: 0,
    trainGoal: 0,
    nextScenarioCountdown: null,
    paused: false,
    parked: false,
    training: false,
    lastFrame: null,
    policy: cloneParkingPolicy(parkingDefaultPolicy),
    bestPolicy: cloneParkingPolicy(parkingDefaultPolicy),
  };

  const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
  const radiansToDegrees = (angle) => Math.round((angle * 180) / Math.PI);
  const parkingScenarioLabel = () => (parkingState.scenario ? `${parkingState.scenario.label} spot` : 'Parking spot');
  const createParkingAdjustmentState = () => ({
    active: false,
    done: false,
    moves: 0,
    timer: 0,
    direction: -1,
  });

  const pickParkingScenarioType = (previousLabel = '') => {
    const options = previousLabel
      ? parkingScenarioTypes.filter((type) => type.label !== previousLabel)
      : parkingScenarioTypes;
    const totalChance = options.reduce((total, type) => total + type.chance, 0);
    const roll = Math.random() * totalChance;
    let cutoff = 0;
    for (const type of options) {
      cutoff += type.chance;
      if (roll <= cutoff) return type;
    }
    return options[0] || parkingScenarioTypes[1];
  };

  const createParkingScenario = (forcedLabel = '') => {
    const forcedType = forcedLabel && parkingScenarioTypes.find((type) => type.label === forcedLabel);
    const type = forcedType || pickParkingScenarioType(parkingState.scenario && parkingState.scenario.label);
    const gap = Math.round(randomRange(type.gapRange));
    let targetX = Math.round(randomRange([315, 410]));
    if (parkingState.scenario && Math.abs(targetX - parkingState.scenario.targetX) < 28) {
      targetX += targetX < 362 ? 38 : -38;
    }
    targetX = clamp(targetX, 315, 410);
    return {
      id: parkingState.scenarioCount + 1,
      label: type.label,
      gap,
      color: type.color,
      targetX,
      targetY: parkingCloseParkedY,
      startX: clamp(targetX + 247, 562, 660),
      startY: 252,
    };
  };

  const applyParkingScenario = (scenario, resetPolicy = true) => {
    const parkedLength = 76;
    parkingState.scenario = scenario;
    parkingState.scenarioCount += 1;
    parkingTarget.x = scenario.targetX;
    parkingTarget.y = scenario.targetY;
    parkingTarget.angle = 0;
    parkingParkedCars.length = 0;
    const leftClearance = scenario.gap * 0.42;
    const rightClearance = scenario.gap - leftClearance;
    parkingParkedCars.push(
      {
        x: scenario.targetX - leftClearance - parkedLength / 2,
        y: scenario.targetY,
        angle: 0,
        length: parkedLength,
        width: 34,
        color: '#71717a',
      },
      {
        x: scenario.targetX + rightClearance + parkedLength / 2,
        y: scenario.targetY,
        angle: 0,
        length: parkedLength,
        width: 34,
        color: '#71717a',
      },
    );

    if (resetPolicy) {
      parkingState.policy = cloneParkingPolicy(parkingDefaultPolicy);
      parkingState.bestPolicy = cloneParkingPolicy(parkingDefaultPolicy);
      parkingState.bestReward = null;
      parkingState.episodesTrained = 0;
    }
  };

  const parkingInitialCar = () => ({
    x: parkingState.scenario ? parkingState.scenario.startX : parkingTarget.x + 247,
    y: parkingState.scenario ? parkingState.scenario.startY : 252,
    angle: 0,
    speed: 0,
    steer: 0,
    throttle: 0,
    collided: false,
  });

  const resetParking = ({ newScenario = false, resetPolicy = false, scenarioType = '' } = {}) => {
    if (newScenario || !parkingState.scenario) {
      applyParkingScenario(createParkingScenario(scenarioType), true);
    } else if (resetPolicy) {
      parkingState.policy = cloneParkingPolicy(parkingDefaultPolicy);
      parkingState.bestPolicy = cloneParkingPolicy(parkingDefaultPolicy);
      parkingState.bestReward = null;
      parkingState.episodesTrained = 0;
    }

    parkingState.car = parkingInitialCar();
    parkingState.phase = 0;
    parkingState.adjustment = createParkingAdjustmentState();
    parkingState.reward = 0;
    parkingState.episodeReward = 0;
    parkingState.collisions = 0;
    parkingState.steps = 0;
    parkingState.parked = false;
    parkingState.nextScenarioCountdown = null;
    parkingState.lastFrame = null;
    parkingSteer.value = '0';
    parkingThrottle.value = '0';
  };

  const parkingCarCorners = (car, length = parkingCarLength, width = parkingCarWidth) => {
    const cos = Math.cos(car.angle);
    const sin = Math.sin(car.angle);
    const halfLength = length / 2;
    const halfWidth = width / 2;
    return [
      { x: -halfLength, y: -halfWidth },
      { x: halfLength, y: -halfWidth },
      { x: halfLength, y: halfWidth },
      { x: -halfLength, y: halfWidth },
    ].map((point) => ({
      x: car.x + point.x * cos - point.y * sin,
      y: car.y + point.x * sin + point.y * cos,
    }));
  };

  const polygonProjection = (points, axis) => {
    let min = Infinity;
    let max = -Infinity;
    points.forEach((point) => {
      const value = point.x * axis.x + point.y * axis.y;
      min = Math.min(min, value);
      max = Math.max(max, value);
    });
    return { min, max };
  };

  const polygonsOverlap = (first, second) => {
    const axes = [];
    [first, second].forEach((points) => {
      for (let index = 0; index < points.length; index += 1) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        const edge = { x: next.x - current.x, y: next.y - current.y };
        const length = Math.hypot(edge.x, edge.y) || 1;
        axes.push({ x: -edge.y / length, y: edge.x / length });
      }
    });

    return axes.every((axis) => {
      const a = polygonProjection(first, axis);
      const b = polygonProjection(second, axis);
      return a.max >= b.min && b.max >= a.min;
    });
  };

  const parkingCollisionForCar = (car) => {
    const carCorners = parkingCarCorners(car);
    const curbHit = carCorners.some((corner) => corner.y < 78 || corner.y > 342 || corner.x < 55 || corner.x > 705);
    const parkedHit = parkingParkedCars.some((parked) => (
      polygonsOverlap(carCorners, parkingCarCorners(parked, parked.length, parked.width))
    ));
    return curbHit || parkedHit;
  };

  const parkingCollision = () => parkingCollisionForCar(parkingState.car);
  const parkingParkedCenterY = () => (
    parkingParkedCars.length
      ? parkingParkedCars.reduce((total, parked) => total + parked.y, 0) / parkingParkedCars.length
      : parkingTarget.y
  );
  const parkingDistanceForCar = (car) => Math.hypot(car.x - parkingTarget.x, car.y - parkingTarget.y);
  const parkingAngleErrorForCar = (car) => Math.abs(wrapAngle(car.angle - parkingTarget.angle));
  const parkingCenterlinePenalty = (car) => Math.max(0, car.y - parkingParkedCenterY());
  const parkingSidewalkLeadBonus = (car) => Math.max(0, parkingParkedCenterY() - car.y);
  const parkingIsParked = (car) => parkingDistanceForCar(car) < 13 && parkingAngleErrorForCar(car) < 0.1;
  const parkingDistanceToTarget = () => parkingDistanceForCar(parkingState.car);
  const parkingReadyForAdjustment = (car) => (
    parkingDistanceForCar(car) < parkingAdjustmentTriggerDistance
    && parkingAngleErrorForCar(car) < parkingAdjustmentTriggerAngle
  );

  const parkingStartAdjustment = (adjustment, car) => {
    adjustment.active = true;
    adjustment.done = false;
    adjustment.moves = 0;
    adjustment.timer = 0;
    adjustment.direction = Math.sign(parkingTarget.x - car.x) || (car.speed < 0 ? 1 : -1);
  };

  const parkingAdjustmentActionFor = (car, adjustment, dt) => {
    const angleError = wrapAngle(car.angle - parkingTarget.angle);
    const yError = parkingTarget.y - car.y;
    const steer = clamp(
      angleError * 1.55 + yError * 0.026,
      -0.42,
      0.42,
    );
    const action = {
      throttle: adjustment.direction * parkingAdjustmentThrottle,
      steer,
      phase: 4,
      parked: false,
      adjusting: true,
    };
    const aligned = adjustment.moves > 0
      && parkingDistanceForCar(car) < 7
      && parkingAngleErrorForCar(car) < 0.055;
    const unsafe = parkingWouldCollideAfterAction(car, action, 0.16);

    adjustment.timer += dt;
    if (aligned || unsafe || adjustment.timer >= parkingAdjustmentMoveSeconds) {
      adjustment.moves += 1;
      adjustment.timer = 0;
      if (aligned || adjustment.moves >= parkingAdjustmentMaxMoves) {
        adjustment.active = false;
        adjustment.done = true;
        return {
          throttle: 0,
          steer: -angleError * 0.65,
          phase: 4,
          parked: aligned || parkingIsParked(car),
          adjusting: false,
        };
      }
      adjustment.direction *= -1;
      return {
        throttle: 0,
        steer,
        phase: 4,
        parked: false,
        adjusting: true,
      };
    }

    return action;
  };

  const parkingPolicyActionFor = (car, policy = parkingState.policy, adjustment = null, dt = 1 / 30) => {
    const distance = parkingDistanceForCar(car);
    const angleError = wrapAngle(car.angle - parkingTarget.angle);
    const phase1X = parkingTarget.x + policy.phase1Offset;
    const phase2X = parkingTarget.x + policy.phase2Offset;
    const phase2Y = parkingTarget.y + policy.phase2YOffset;
    let throttle = -0.55;
    let steer = 0;
    let phase = 1;
    let parked = false;

    if (adjustment && adjustment.active) {
      return parkingAdjustmentActionFor(car, adjustment, dt);
    }

    if (car.x > phase1X) {
      phase = 1;
      steer = policy.phase1Steer;
      throttle = policy.phase1Throttle;
    } else if (car.x > phase2X || car.y > phase2Y) {
      phase = 2;
      steer = policy.phase2Steer;
      throttle = policy.phase2Throttle;
    } else {
      phase = 3;
      if (adjustment && !adjustment.done && parkingReadyForAdjustment(car)) {
        parkingStartAdjustment(adjustment, car);
        return parkingAdjustmentActionFor(car, adjustment, dt);
      }
      throttle = clamp((parkingTarget.x - car.x) * policy.finalThrottleGain, policy.finalMinThrottle, policy.finalMaxThrottle);
      steer = clamp(
        angleError * policy.finalAngleGain + (parkingTarget.y - car.y) * policy.finalYGain,
        -policy.finalMaxSteer,
        policy.finalMaxSteer,
      );
      if (distance < 13 && Math.abs(angleError) < 0.1) {
        throttle = 0;
        steer = -angleError * 0.7;
        parked = true;
      }
    }

    return { throttle, steer, phase, parked };
  };

  const parkingPolicyAction = (dt) => {
    const action = parkingPolicyActionFor(parkingState.car, parkingState.policy, parkingState.adjustment, dt);
    parkingState.phase = action.phase;
    if (action.parked) parkingState.parked = true;
    return action;
  };

  const parkingManualAction = () => ({
    throttle: Number(parkingThrottle.value) / 100,
    steer: (Number(parkingSteer.value) * Math.PI) / 180,
  });

  const applyParkingAction = (car, action, dt) => {
    const maxSteer = (35 * Math.PI) / 180;
    const targetSpeed = action.throttle * 94;
    car.throttle = action.throttle;
    car.steer += (clamp(action.steer, -maxSteer, maxSteer) - car.steer) * Math.min(1, dt * 5.2);
    car.speed += (targetSpeed - car.speed) * Math.min(1, dt * 3.8);
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    car.angle = wrapAngle(car.angle + (car.speed / parkingWheelbase) * Math.tan(car.steer) * dt);
  };

  const parkingWouldCollideAfterAction = (car, action, dt) => {
    const preview = { ...car };
    applyParkingAction(preview, action, dt);
    return parkingCollisionForCar(preview);
  };

  const parkingStepReward = (car, previousDistance, previousAngle, previousCenterlinePenalty, didCollide, didPark) => {
    const distance = parkingDistanceForCar(car);
    const angle = parkingAngleErrorForCar(car);
    const centerlinePenalty = parkingCenterlinePenalty(car);
    const sidewalkLead = parkingSidewalkLeadBonus(car);
    const distanceProgress = previousDistance - distance;
    const angleProgress = previousAngle - angle;
    const sidewalkProgress = previousCenterlinePenalty - centerlinePenalty;
    let reward = distanceProgress * 0.85 + angleProgress * 45;
    reward += sidewalkProgress * 0.1;
    reward += clamp(24 - centerlinePenalty * 0.18, 0, 24) * 0.04;
    if (!didCollide && sidewalkLead > 0) reward += 28 + clamp(sidewalkLead * 0.85, 0, 42);
    reward -= distance * 0.01;
    reward -= Math.abs(radiansToDegrees(angle)) * 0.07;
    reward -= Math.abs(car.speed) * 0.012;
    reward -= centerlinePenalty * 0.012;
    reward -= 0.35;
    if (didCollide) reward -= 260;
    if (didPark) reward += 520;
    return reward;
  };

  const formatParkingReward = (value) => {
    const rounded = Math.round(value);
    return rounded > 0 ? `+${rounded}` : String(rounded);
  };

  const paintParkingReward = (element, value) => {
    element.classList.toggle('reward-positive', value > 0);
    element.classList.toggle('reward-negative', value < 0);
  };

  const simulateParkingPolicy = (policy) => {
    const car = parkingInitialCar();
    const dt = 1 / 30;
    const maxSteps = 360;
    let score = 0;
    let collisions = 0;
    let parked = false;
    let step = 0;
    const adjustment = createParkingAdjustmentState();

    for (; step < maxSteps; step += 1) {
      const previousDistance = parkingDistanceForCar(car);
      const previousAngle = parkingAngleErrorForCar(car);
      const previousCenterlinePenalty = parkingCenterlinePenalty(car);
      const action = parkingPolicyActionFor(car, policy, adjustment, dt);
      applyParkingAction(car, action, dt);

      const didCollide = parkingCollisionForCar(car);
      if (didCollide) {
        collisions += 1;
        car.collided = true;
        car.speed = 0;
        car.throttle = 0;
      }

      const didPark = !didCollide && (action.parked || parkingIsParked(car));
      if (didPark) {
        parked = true;
        car.speed = 0;
        car.throttle = 0;
      }

      score += parkingStepReward(car, previousDistance, previousAngle, previousCenterlinePenalty, didCollide, didPark);
      if (didCollide || didPark) break;
    }

    const distance = parkingDistanceForCar(car);
    const angle = parkingAngleErrorForCar(car);
    const sidewalkLead = parkingSidewalkLeadBonus(car);
    score += clamp(160 - distance * 0.75 - Math.abs(radiansToDegrees(angle)) * 1.8 - parkingCenterlinePenalty(car) * 0.55, -180, 160);
    if (!collisions && sidewalkLead > 0) score += clamp(70 + sidewalkLead * 1.2, 0, 118);
    score += parked ? 80 : -40;
    score -= collisions * 120;
    return { score, policy, parked, collisions, distance, angle, steps: step + 1 };
  };

  const trainParkingPolicy = () => {
    if (parkingState.training) return;
    const totalEpisodes = Number(parkingTrainEpisodes.value);
    const wasPaused = parkingState.paused;
    parkingState.training = true;
    parkingState.paused = true;
    parkingState.trainProgress = 0;
    parkingState.trainGoal = totalEpisodes;
    parkingState.nextScenarioCountdown = null;
    parkingMode.value = 'policy';

    let bestPolicy = cloneParkingPolicy(parkingState.bestPolicy || parkingState.policy);
    let bestResult = simulateParkingPolicy(bestPolicy);
    if (parkingState.bestReward !== null && parkingState.bestReward > bestResult.score) {
      bestResult = { ...bestResult, score: parkingState.bestReward };
    }

    const runBatch = () => {
      const batchSize = 8;
      for (let index = 0; index < batchSize && parkingState.trainProgress < totalEpisodes; index += 1) {
        const progress = parkingState.trainProgress / Math.max(1, totalEpisodes);
        const intensity = Math.max(0.25, 1 - progress);
        const candidate = parkingState.trainProgress === 0
          ? cloneParkingPolicy(parkingState.policy)
          : Math.random() < 0.18
            ? sampleParkingPolicy()
            : mutateParkingPolicy(bestPolicy, intensity);
        const result = simulateParkingPolicy(candidate);
        if (result.score > bestResult.score) {
          bestResult = result;
          bestPolicy = cloneParkingPolicy(candidate);
        }
        parkingState.trainProgress += 1;
      }

      parkingState.bestReward = Math.round(bestResult.score);
      parkingState.bestPolicy = cloneParkingPolicy(bestPolicy);
      parkingBestReward.textContent = formatParkingReward(parkingState.bestReward);
      paintParkingReward(parkingBestReward, parkingState.bestReward);
      parkingStatus.textContent = `Training ${parkingState.trainProgress}/${totalEpisodes}`;
      updateParkingControls();

      if (parkingState.trainProgress < totalEpisodes) {
        window.setTimeout(runBatch, 0);
        return;
      }

      parkingState.policy = cloneParkingPolicy(bestPolicy);
      parkingState.episodesTrained += totalEpisodes;
      parkingState.training = false;
      parkingState.paused = wasPaused;
      resetParking();
      parkingPause.textContent = parkingState.paused ? 'Resume' : 'Pause';
      updateParkingControls();
      updateParkingMetrics();
      parkingStatus.textContent = `Trained ${totalEpisodes} episodes - ${parkingScenarioLabel()}`;
      drawParking();
    };

    updateParkingControls();
    runBatch();
  };

  const updateParkingControls = () => {
    parkingTrainValue.value = parkingTrainEpisodes.value;
    parkingSteerValue.value = `${parkingSteer.value} deg`;
    parkingThrottleValue.value = `${parkingThrottle.value}%`;
    const manual = parkingMode.value === 'manual';
    parkingSteer.disabled = !manual || parkingState.training;
    parkingThrottle.disabled = !manual || parkingState.training;
    parkingTrainEpisodes.disabled = parkingState.training;
    parkingMode.disabled = parkingState.training;
    parkingTrain.disabled = parkingState.training;
    parkingSuperTight.disabled = parkingState.training;
    parkingPause.disabled = parkingState.training;
    parkingReset.disabled = parkingState.training;
  };

  const stepParking = (dt) => {
    const car = parkingState.car;
    if (car.collided || parkingState.parked) {
      car.speed *= Math.max(0, 1 - dt * 4);
      return;
    }

    const previousDistance = parkingDistanceForCar(car);
    const previousAngle = parkingAngleErrorForCar(car);
    const previousCenterlinePenalty = parkingCenterlinePenalty(car);
    const action = parkingMode.value === 'manual' ? parkingManualAction() : parkingPolicyAction(dt);
    applyParkingAction(car, action, dt);
    parkingState.steps += 1;

    const didCollide = parkingCollision();
    if (didCollide) {
      car.collided = true;
      car.speed = 0;
      car.throttle = 0;
      parkingState.collisions += 1;
    }

    const didPark = !didCollide && (action.parked || parkingIsParked(car));
    if (didPark) {
      parkingState.parked = true;
      parkingState.nextScenarioCountdown = 1.55;
      car.speed = 0;
      car.throttle = 0;
    }

    const reward = parkingStepReward(car, previousDistance, previousAngle, previousCenterlinePenalty, didCollide, didPark);
    parkingState.reward = Math.round(reward);
    parkingState.episodeReward += reward;
  };

  const advanceParkingScenario = (dt) => {
    if (!parkingState.parked || parkingState.nextScenarioCountdown === null) return;
    parkingState.nextScenarioCountdown -= dt;
    if (parkingState.nextScenarioCountdown <= 0) {
      resetParking({ newScenario: true });
    }
  };

  const updateParkingMetrics = () => {
    const distance = parkingDistanceToTarget();
    const angleError = parkingAngleErrorForCar(parkingState.car);
    const episodeReward = Math.round(parkingState.episodeReward);
    const scenario = parkingState.scenario;
    parkingReward.textContent = formatParkingReward(parkingState.reward);
    parkingEpisodeReward.textContent = formatParkingReward(episodeReward);
    parkingBestReward.textContent = parkingState.bestReward === null ? '--' : formatParkingReward(parkingState.bestReward);
    parkingScenario.textContent = scenario ? `${scenario.label} ${scenario.gap}px` : '--';
    parkingDistance.textContent = `${Math.round(distance)} px`;
    parkingAngle.textContent = `${Math.abs(radiansToDegrees(angleError))} deg`;
    parkingCollisions.textContent = String(parkingState.collisions);
    paintParkingReward(parkingReward, parkingState.reward);
    paintParkingReward(parkingEpisodeReward, episodeReward);
    if (parkingState.bestReward !== null) paintParkingReward(parkingBestReward, parkingState.bestReward);

    if (parkingState.training) parkingStatus.textContent = `Training ${parkingState.trainProgress}/${parkingState.trainGoal} - ${parkingScenarioLabel()}`;
    else if (parkingState.paused) parkingStatus.textContent = `Paused - ${parkingScenarioLabel()}`;
    else if (parkingState.car.collided) parkingStatus.textContent = `Collision - ${parkingScenarioLabel()}`;
    else if (parkingState.adjustment && parkingState.adjustment.active) {
      const move = Math.min(parkingAdjustmentMaxMoves, parkingState.adjustment.moves + 1);
      parkingStatus.textContent = `Adjusting ${move}/${parkingAdjustmentMaxMoves} - ${parkingScenarioLabel()}`;
    }
    else if (parkingState.parked) {
      const seconds = Math.max(1, Math.ceil(parkingState.nextScenarioCountdown || 0));
      parkingStatus.textContent = `Parked - next spot in ${seconds}s`;
    } else if (parkingState.episodesTrained > 0 && parkingState.steps === 0) parkingStatus.textContent = `Trained ${parkingState.episodesTrained} episodes - ${parkingScenarioLabel()}`;
    else parkingStatus.textContent = parkingMode.value === 'manual' ? `Manual control - ${parkingScenarioLabel()}` : `Policy phase ${parkingState.phase || 1} - ${parkingScenarioLabel()}`;

    if (parkingMode.value !== 'manual') {
      parkingSteer.value = String(radiansToDegrees(parkingState.car.steer));
      parkingThrottle.value = String(Math.round(parkingState.car.throttle * 100));
    }
    updateParkingControls();
  };

  const drawParkingRect = (ctx, car, length, width, fill, stroke = 'rgba(0,0,0,.25)') => {
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    roundedRect(ctx, -length / 2, -width / 2, length, width, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.78)';
    roundedRect(ctx, length * 0.08, -width / 2 + 4, length * 0.25, width - 8, 2);
    ctx.fill();
    ctx.restore();
  };

  const drawParkingLot = (ctx, vars, scale = 1) => {
    const isLight = root.dataset.theme === 'light';
    const road = isLight ? '#f4f5f7' : '#151518';
    const curb = isLight ? '#d8dade' : '#302b31';
    const line = isLight ? 'rgba(17, 17, 17, .24)' : 'rgba(255, 255, 255, .2)';
    const scenario = parkingState.scenario || { gap: 130, color: vars.accent };
    const slotLength = scenario.gap;
    const slotHeight = 64;
    const slotX = parkingTarget.x - slotLength / 2;
    const slotY = parkingTarget.y - slotHeight / 2;
    ctx.fillStyle = vars.canvas;
    ctx.fillRect(0, 0, parkingWidth * scale, parkingHeight * scale);
    ctx.fillStyle = road;
    ctx.fillRect(52 * scale, 78 * scale, 656 * scale, 264 * scale);
    ctx.fillStyle = curb;
    ctx.fillRect(52 * scale, 72 * scale, 656 * scale, 8 * scale);
    ctx.fillRect(52 * scale, 342 * scale, 656 * scale, 8 * scale);
    ctx.strokeStyle = line;
    ctx.lineWidth = Math.max(1, 1.5 * scale);
    ctx.setLineDash([18 * scale, 12 * scale]);
    ctx.beginPath();
    ctx.moveTo(68 * scale, 248 * scale);
    ctx.lineTo(692 * scale, 248 * scale);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = scenario.color || vars.accent;
    ctx.lineWidth = Math.max(1, 2 * scale);
    ctx.strokeRect(slotX * scale, slotY * scale, slotLength * scale, slotHeight * scale);
    ctx.save();
    ctx.globalAlpha = isLight ? 0.1 : 0.16;
    ctx.fillStyle = scenario.color || vars.accent;
    ctx.fillRect(slotX * scale, slotY * scale, slotLength * scale, slotHeight * scale);
    ctx.restore();
  };

  const drawParking = () => {
    const ctx = parkingCanvas.getContext('2d');
    const vars = getVars();
    drawParkingLot(ctx, vars, 1);
    parkingParkedCars.forEach((parked) => drawParkingRect(ctx, parked, parked.length, parked.width, parked.color, vars.border));

    ctx.save();
    ctx.strokeStyle = 'rgba(56, 189, 248, .28)';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 8]);
    ctx.beginPath();
    ctx.arc(parkingState.car.x, parkingState.car.y, 58, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    drawParkingRect(
      ctx,
      parkingState.car,
      parkingCarLength,
      parkingCarWidth,
      parkingState.car.collided ? '#fb365f' : '#38bdf8',
      parkingState.car.collided ? '#fff' : '#083344',
    );

    ctx.save();
    ctx.translate(parkingTarget.x, parkingTarget.y);
    ctx.rotate(parkingTarget.angle);
    ctx.strokeStyle = 'rgba(34, 197, 94, .72)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    roundedRect(ctx, -parkingCarLength / 2, -parkingCarWidth / 2, parkingCarLength, parkingCarWidth, 5);
    ctx.stroke();
    ctx.restore();

    drawParkingSensors();
  };

  const parkingPovPoint = (point, origin, angle, width, height) => {
    const forward = { x: Math.cos(angle), y: Math.sin(angle) };
    const right = { x: -Math.sin(angle), y: Math.cos(angle) };
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    const depth = dx * forward.x + dy * forward.y;
    const lateral = dx * right.x + dy * right.y;
    const range = 230;
    const scale = height / range;
    return {
      x: width / 2 + lateral * scale,
      y: height - depth * scale,
      depth,
    };
  };

  const drawParkingPovLine = (ctx, points, origin, angle, width, height) => {
    const projected = points.map((point) => parkingPovPoint(point, origin, angle, width, height));
    if (projected.every((point) => point.depth < -12 || point.depth > 240)) return;
    ctx.beginPath();
    projected.forEach((point, index) => {
      const x = clamp(point.x, -width * 0.4, width * 1.4);
      const y = clamp(point.y, -height * 0.4, height * 1.4);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };

  const drawParkingPovPolygon = (ctx, points, origin, angle, width, height, fill, stroke) => {
    const projected = points.map((point) => parkingPovPoint(point, origin, angle, width, height));
    if (projected.every((point) => point.depth < -12 || point.depth > 240)) return;
    ctx.beginPath();
    projected.forEach((point, index) => {
      const x = clamp(point.x, -width * 0.45, width * 1.45);
      const y = clamp(point.y, -height * 0.45, height * 1.45);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.fill();
    ctx.stroke();
  };

  const drawParkingPov = (sensorCanvas, dctCanvas, reverse = false) => {
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = 128;
    sourceCanvas.height = 96;
    const ctx = sourceCanvas.getContext('2d');
    const width = sourceCanvas.width;
    const height = sourceCanvas.height;
    const vars = getVars();
    const isLight = root.dataset.theme === 'light';
    const car = parkingState.car;
    const direction = reverse ? -1 : 1;
    const angle = car.angle + (reverse ? Math.PI : 0);
    const origin = {
      x: car.x + Math.cos(car.angle) * parkingCarLength * 0.52 * direction,
      y: car.y + Math.sin(car.angle) * parkingCarLength * 0.52 * direction,
    };

    ctx.fillStyle = vars.canvas;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = isLight ? '#f5f6f8' : '#151518';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = isLight ? 'rgba(17, 17, 17, .16)' : 'rgba(255, 255, 255, .16)';
    ctx.lineWidth = 1;
    for (let depth = 42; depth <= 210; depth += 42) {
      const y = height - depth * (height / 230);
      ctx.beginPath();
      ctx.moveTo(8, y);
      ctx.lineTo(width - 8, y);
      ctx.stroke();
    }
    for (let offset = -80; offset <= 80; offset += 40) {
      ctx.beginPath();
      ctx.moveTo(width / 2 + offset * 0.1, height);
      ctx.lineTo(width / 2 + offset * (height / 230), 0);
      ctx.stroke();
    }

    ctx.lineWidth = 2;
    ctx.strokeStyle = isLight ? '#c6c9cf' : '#343038';
    drawParkingPovLine(ctx, [{ x: 54, y: 78 }, { x: 706, y: 78 }], origin, angle, width, height);
    drawParkingPovLine(ctx, [{ x: 54, y: 342 }, { x: 706, y: 342 }], origin, angle, width, height);
    ctx.setLineDash([7, 6]);
    ctx.strokeStyle = isLight ? 'rgba(17, 17, 17, .25)' : 'rgba(255, 255, 255, .22)';
    drawParkingPovLine(ctx, [{ x: 64, y: 248 }, { x: 696, y: 248 }], origin, angle, width, height);
    ctx.setLineDash([]);

    const scenario = parkingState.scenario || { gap: 190, color: vars.accent };
    const slotHeight = 64;
    const slotCorners = [
      { x: parkingTarget.x - scenario.gap / 2, y: parkingTarget.y - slotHeight / 2 },
      { x: parkingTarget.x + scenario.gap / 2, y: parkingTarget.y - slotHeight / 2 },
      { x: parkingTarget.x + scenario.gap / 2, y: parkingTarget.y + slotHeight / 2 },
      { x: parkingTarget.x - scenario.gap / 2, y: parkingTarget.y + slotHeight / 2 },
    ];
    drawParkingPovPolygon(ctx, slotCorners, origin, angle, width, height, 'rgba(34, 197, 94, .1)', scenario.color || vars.accent);
    parkingParkedCars.forEach((parked) => {
      drawParkingPovPolygon(ctx, parkingCarCorners(parked, parked.length, parked.width), origin, angle, width, height, '#71717a', vars.border);
    });

    ctx.fillStyle = reverse ? '#fb365f' : '#38bdf8';
    roundedRect(ctx, width / 2 - 22, height - 13, 44, 10, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, .74)';
    ctx.fillRect(width / 2 - 2, height - 18, 4, 12);

    const sensorData = ctx.getImageData(0, 0, width, height);
    putImageData(sensorCanvas, sensorData);
    putImageData(dctCanvas, compressDct(sensorData, parkingPovDctBudget.keep).error);
  };

  const drawParkingSensors = () => {
    drawParkingPov(parkingFrontSensor, parkingFrontDct, false);
    drawParkingPov(parkingRearSensor, parkingRearDct, true);
  };

  const runParkingFrame = (now) => {
    if (parkingState.lastFrame === null) parkingState.lastFrame = now;
    const dt = Math.min((now - parkingState.lastFrame) / 1000, 0.05);
    parkingState.lastFrame = now;
    if (!parkingState.paused) {
      if (parkingState.parked) advanceParkingScenario(dt);
      else stepParking(dt);
    }
    updateParkingMetrics();
    drawParking();
    requestAnimationFrame(runParkingFrame);
  };

  [parkingMode, parkingTrainEpisodes, parkingSteer, parkingThrottle].forEach((control) => {
    control.addEventListener('input', updateParkingControls);
    control.addEventListener('change', updateParkingControls);
  });

  parkingMode.addEventListener('change', () => {
    updateParkingControls();
    updateParkingMetrics();
  });

  parkingTrain.addEventListener('click', trainParkingPolicy);

  parkingSuperTight.addEventListener('click', () => {
    const wasPaused = parkingState.paused;
    resetParking({ newScenario: true, scenarioType: 'Super Tight' });
    parkingState.paused = wasPaused;
    parkingPause.textContent = parkingState.paused ? 'Resume' : 'Pause';
    updateParkingControls();
    updateParkingMetrics();
    drawParking();
  });

  parkingPause.addEventListener('click', () => {
    parkingState.paused = !parkingState.paused;
    parkingPause.textContent = parkingState.paused ? 'Resume' : 'Pause';
    updateParkingMetrics();
    drawParking();
  });

  parkingReset.addEventListener('click', () => {
    const wasPaused = parkingState.paused;
    resetParking();
    parkingState.paused = wasPaused;
    parkingPause.textContent = parkingState.paused ? 'Resume' : 'Pause';
    updateParkingMetrics();
    drawParking();
  });
  const setKnnImage = (image, label) => {
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const ratio = Math.min(1, maxKnnSide / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * ratio));
    const height = Math.max(1, Math.round(sourceHeight * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, width, height);
    knnState.imageData = ctx.getImageData(0, 0, width, height);
    knnState.width = width;
    knnState.height = height;
    knnState.label = ratio < 1 ? `${label} capped` : label;
    knnDownload.disabled = false;
    renderKnn();
  };

  const getKnnOffsets = (scale, k) => {
    const key = `${scale}-${k}`;
    if (knnOffsetCache.has(key)) return knnOffsetCache.get(key);
    const radius = Math.max(2, Math.ceil(Math.sqrt(k)) + 1);
    const phases = [];

    for (let phaseY = 0; phaseY < scale; phaseY += 1) {
      for (let phaseX = 0; phaseX < scale; phaseX += 1) {
        const sx = (phaseX + 0.5) / scale - 0.5;
        const sy = (phaseY + 0.5) / scale - 0.5;
        const baseX = Math.floor(sx);
        const baseY = Math.floor(sy);
        const offsets = [];
        for (let yy = baseY - radius; yy <= baseY + radius; yy += 1) {
          for (let xx = baseX - radius; xx <= baseX + radius; xx += 1) {
            offsets.push({
              dx: xx - baseX,
              dy: yy - baseY,
              distance: (sx - xx) ** 2 + (sy - yy) ** 2,
            });
          }
        }
        phases[phaseY * scale + phaseX] = offsets.sort((a, b) => a.distance - b.distance).slice(0, k);
      }
    }

    knnOffsetCache.set(key, phases);
    return phases;
  };

  const upscaleKnn = () => {
    const source = knnState.imageData;
    const scale = Number(knnScale.value);
    const k = Number(knnNeighbors.value);
    const targetWidth = source.width * scale;
    const targetHeight = source.height * scale;
    const output = new ImageData(targetWidth, targetHeight);
    const phaseOffsets = getKnnOffsets(scale, k);

    for (let y = 0; y < targetHeight; y += 1) {
      const sy = (y + 0.5) / scale - 0.5;
      const baseY = Math.floor(sy);
      const phaseY = y % scale;
      for (let x = 0; x < targetWidth; x += 1) {
        const sx = (x + 0.5) / scale - 0.5;
        const baseX = Math.floor(sx);
        const phaseX = x % scale;
        const offsets = phaseOffsets[phaseY * scale + phaseX];
        const targetIndex = (y * targetWidth + x) * 4;
        let totalWeight = 0;
        let red = 0;
        let green = 0;
        let blue = 0;
        let alpha = 0;

        for (let offsetIndex = 0; offsetIndex < offsets.length; offsetIndex += 1) {
          const offset = offsets[offsetIndex];
          const px = clamp(baseX + offset.dx, 0, source.width - 1);
          const py = clamp(baseY + offset.dy, 0, source.height - 1);
          const sourceIndex = (py * source.width + px) * 4;
          const weight = 1 / (offset.distance + 0.0001);
          totalWeight += weight;
          red += source.data[sourceIndex] * weight;
          green += source.data[sourceIndex + 1] * weight;
          blue += source.data[sourceIndex + 2] * weight;
          alpha += source.data[sourceIndex + 3] * weight;
        }

        output.data[targetIndex] = red / totalWeight;
        output.data[targetIndex + 1] = green / totalWeight;
        output.data[targetIndex + 2] = blue / totalWeight;
        output.data[targetIndex + 3] = alpha / totalWeight;
      }
    }

    return output;
  };

  const renderKnn = () => {
    knnValue.value = knnNeighbors.value;
    if (!knnState.imageData) return;
    putImageData(knnSource, knnState.imageData);
    const output = upscaleKnn();
    putImageData(knnOutput, output);
    knnStatus.textContent = `${knnState.label} | ${knnState.width}x${knnState.height} -> ${output.width}x${output.height} | k=${knnNeighbors.value}`;
  };

  const scheduleKnn = () => {
    if (knnState.pending) return;
    knnState.pending = true;
    requestAnimationFrame(() => {
      knnState.pending = false;
      renderKnn();
    });
  };

  knnUpload.addEventListener('change', () => {
    const file = knnUpload.files && knnUpload.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      setKnnImage(image, file.name);
      URL.revokeObjectURL(url);
    };
    image.src = url;
  });

  [knnNeighbors, knnScale].forEach((control) => {
    control.addEventListener('input', scheduleKnn);
    control.addEventListener('change', scheduleKnn);
  });
  knnDownload.addEventListener('click', () => {
    if (!knnState.imageData) return;
    const filename = `knn-upscale-${safeFileLabel(knnState.label)}-${knnScale.value}x-k${knnNeighbors.value}.png`;
    downloadCanvasPng(knnOutput, filename);
  });

  new MutationObserver(() => {
    drawTraffic();
    drawParking();
    drawClusters();
    drawConvolution();
  }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  resetTraffic();
  updateTrafficControls();
  updateTrafficMetrics();
  drawTraffic();
  requestAnimationFrame(runTrafficFrame);
  resetParking();
  updateParkingControls();
  updateParkingMetrics();
  drawParking();
  requestAnimationFrame(runParkingFrame);
  seedClusterPoints();
  renderKernelGrid();
  resetConvGrid();
})();

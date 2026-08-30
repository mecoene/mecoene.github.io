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
  const knnSample = $('knnSample');
  const knnDownload = $('knnDownload');
  const knnStatus = $('knnStatus');
  const maxKnnSide = 400;
  const knnOffsetCache = new Map();
  const knnState = {
    imageData: null,
    width: 96,
    height: 96,
    label: 'Sample image',
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
  const dctSample = $('dctSample');
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
    label: 'Sample image',
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
    renderDct();
  };

  const makeDctSampleImage = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 192;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#070708');
    gradient.addColorStop(0.45, '#5b0b1c');
    gradient.addColorStop(1, '#fff7f8');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < canvas.height; y += 8) {
      for (let x = 0; x < canvas.width; x += 8) {
        ctx.fillStyle = (x / 8 + y / 8) % 2 === 0 ? 'rgba(255,255,255,.18)' : 'rgba(225,29,72,.22)';
        ctx.fillRect(x, y, 8, 8);
      }
    }
    ctx.fillStyle = '#fff7f8';
    ctx.beginPath();
    ctx.arc(56, 58, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e11d48';
    ctx.beginPath();
    ctx.arc(61, 54, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#070708';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(103, 30);
    ctx.lineTo(150, 30);
    ctx.lineTo(116, 92);
    ctx.lineTo(166, 92);
    ctx.stroke();
    dctState.imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    dctState.width = canvas.width;
    dctState.height = canvas.height;
    dctState.label = 'Sample image';
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
    if (!dctState.imageData) return;
    const keep = Number(dctKeep.value);
    dctKeepValue.value = `${keep}/64`;
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
  dctSample.addEventListener('click', makeDctSampleImage);
  dctDownload.addEventListener('click', () => {
    const mode = dctMode.value === 'error' ? 'error-map' : 'compressed';
    const filename = `dct-${mode}-${safeFileLabel(dctState.label)}-keep${dctKeep.value}.png`;
    downloadCanvasPng(dctOutput, filename);
  });

  const makeSampleImage = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 96, 96);
    gradient.addColorStop(0, '#070708');
    gradient.addColorStop(1, '#350711');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 96, 96);
    ctx.fillStyle = '#fff7f8';
    ctx.fillRect(16, 18, 30, 10);
    ctx.fillRect(16, 43, 25, 10);
    ctx.fillRect(16, 68, 32, 10);
    ctx.fillRect(16, 18, 10, 60);
    ctx.beginPath();
    ctx.moveTo(56, 78);
    ctx.lineTo(56, 18);
    ctx.lineTo(72, 48);
    ctx.lineTo(88, 18);
    ctx.lineTo(88, 78);
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#fff7f8';
    ctx.stroke();
    ctx.fillStyle = '#fb365f';
    [[16, 18], [46, 18], [41, 48], [48, 73], [72, 48], [88, 18], [88, 78]].forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y, 4.6, 0, Math.PI * 2);
      ctx.fill();
    });
    knnState.imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    knnState.width = canvas.width;
    knnState.height = canvas.height;
    knnState.label = 'Sample image';
    renderKnn();
  };

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
  knnSample.addEventListener('click', makeSampleImage);
  knnDownload.addEventListener('click', () => {
    const filename = `knn-upscale-${safeFileLabel(knnState.label)}-${knnScale.value}x-k${knnNeighbors.value}.png`;
    downloadCanvasPng(knnOutput, filename);
  });

  new MutationObserver(() => {
    drawClusters();
    drawConvolution();
  }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  seedClusterPoints();
  renderKernelGrid();
  resetConvGrid();
  makeDctSampleImage();
  makeSampleImage();
})();

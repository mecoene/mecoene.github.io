# Academic Portfolio — GitHub Pages

A clean, static academic personal website inspired by .... No build step, no Jekyll, no dependencies — just push and it works.

## Files

```
index.html          ← About / home page
publications.html   ← Publications list
cv.html             ← Curriculum vitae
blog.html           ← Blog posts
style.css           ← All styles
assets/
  profile.jpg       ← Your profile photo (add this yourself)
  cv.pdf            ← Your CV PDF (optional)
```

## Deploy to GitHub Pages (5 minutes)

1. **Create a new repo** on GitHub named `yourusername.github.io`
   - This becomes your site at `https://yourusername.github.io`
   - Or use any repo name — it'll be at `https://yourusername.github.io/reponame`

2. **Push these files** to the `main` branch:
   ```bash
   git init
   git add .
   git commit -m "Initial portfolio"
   git remote add origin https://github.com/yourusername/yourusername.github.io.git
   git push -u origin main
   ```

3. **Enable GitHub Pages**:
   - Go to repo **Settings → Pages**
   - Source: `Deploy from a branch`
   - Branch: `main`, folder: `/ (root)`
   - Save — your site is live in ~1 minute.

4. **Add your photo**: Drop a `profile.jpg` into `assets/` and commit.

## Customise

| What | Where |
|------|-------|
| Name, bio, links | `index.html` — the `<section class="hero">` block |
| Social icons | Add/remove `<a class="social-icon">` elements |
| Publications | `publications.html` — copy a `.pub-item` block |
| Education & interests | `index.html` — `.timeline` and `.interests-list` |
| News | `index.html` — the `<table class="news-table">` |
| Colors & fonts | `style.css` — the `:root` block at the top |
| Add pages | Copy any `.html` file, update the `<nav>` links |

## Custom domain (optional)

1. Add a `CNAME` file to the repo root containing your domain:
   ```
   yourdomain.com
   ```
2. Point your domain's DNS to GitHub Pages (see [GitHub docs](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site)).

# DeformX Project Page

Project website for **DeformX: A Versatile Co-Simulation Framework for Deformable Linear Objects**, accepted at IROS 2026.

Live site: https://deformx.github.io/

## Repository Layout

```text
.
|-- index.html
`-- assets/
    |-- img/       # website images and Open Graph preview
    `-- videos/    # embedded demo videos
```

The site is a static single-page website. Styles and scripts are embedded in `index.html`.

## Local Preview

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000 in a browser.

## Updating The Site

Build or export the website so the deploy directory contains `index.html` and `assets/`, then replace the repository root contents with that deploy output and push `main`.

# DeformX — Project Page

Project website for **DeformX: A Versatile Co-Simulation Framework for Deformable Linear Objects** — a co-simulation framework that couples a dedicated Cosserat rod physics engine with NVIDIA Isaac Sim for physically faithful and visually realistic simulation of wires, cables, and ropes, supporting perception and robot learning.

🔗 Live site: `https://deformx.github.io` (GitHub Pages, served from `main`).

## Structure

```
.
├── index.html              # single-page site (all content)
├── static/
│   ├── css/style.css       # design system + responsive layout
│   ├── js/main.js          # scrollspy, BibTeX copy, figure lightbox
│   └── images/             # web-optimized figures (from the paper)
└── .nojekyll               # serve files as-is (no Jekyll processing)
```

## Fill in before publishing

The header/nav links are placeholders. Set the real URLs in `index.html`
(search for `data-link=`):

| Link        | Where                          |
|-------------|--------------------------------|
| `paper`     | hosted PDF                     |
| `arxiv`     | arXiv abstract page            |
| `code`      | GitHub repository              |
| `dataset`   | WireSeg-32k download/landing   |

Also update the `booktitle` / `year` in the BibTeX block once the venue is confirmed.

## Local preview

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Images

Figures were exported from the paper and downsized/recompressed for the web
(`sips`). Replace files in `static/images/` to update — keep the same filenames,
or update the `src` attributes in `index.html`.

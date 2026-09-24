# Contributing

Thanks for your interest in improving Video Tools.

## Development setup

```bash
git clone https://github.com/David-Raffo/videotools.git
cd videotools
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
DATA_DIR=./data uvicorn app.main:app --reload --port 8000
```

FFmpeg 7 must be available in your `PATH`. Open <http://localhost:8000>.

The frontend is plain HTML, CSS and JavaScript served from `static/`, so there is no build step: reload the page to see changes.

## Before opening a pull request

```bash
pip install ruff
ruff check app
node --check static/app.js
docker build -t videotools:dev .
```

- Keep pull requests focused on a single change.
- Describe what changed and how you tested it.
- Use clear commit messages in the imperative mood (`Add HLG tone mapping`, `Fix audio drift after split`).

## Reporting bugs

Open an issue using the bug report template and include the browser, the server environment and the container logs.

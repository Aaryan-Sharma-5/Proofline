# Internal analysis service. No public ingress: reachable only from the gateway over the compose-internal network
FROM python:3.13-slim

# tesseract is an OS binary that pytesseract shells out to, so pip alone is not enough
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/

# The judge corpus is generated, not committed (it is gitignored), so the reference agent's CLEAR/REVIEW samples must be built into the image.
RUN python backend/make_test_docs.py

ENV PYTHONUNBUFFERED=1 \
    ANALYSIS_HOST=0.0.0.0 \
    ANALYSIS_PORT=8099 \
    DATABASE_URL=/data/proofline.db

# Bound to 0.0.0.0 inside the container, but the compose network never publishes this port to the host, so it stays private.
EXPOSE 8099

CMD ["python", "backend/app.py"]

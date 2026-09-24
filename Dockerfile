FROM python:3.13-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg mesa-va-drivers vainfo fontconfig fonts-dejavu-core fonts-liberation2 fonts-noto-core fonts-noto-cjk \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY static ./static

ENV DATA_DIR=/data PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*", "--timeout-keep-alive", "75"]

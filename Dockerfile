# Hosted demo of SeenSooner: one container serves the Python API and all four frontends.
# Deploy on Render (or any Docker host). The app listens on $PORT (default 8000).
ARG APP=source_snapshot_4/Halvian_SeenSooner_Demo

FROM node:22-slim AS web
ARG APP
# Render passes service environment variables as build args; the nurse app needs the token at build time.
ARG SEENSOONER_STAFF_TOKEN=
WORKDIR /app
COPY ${APP}/patient-app/package*.json patient-app/
COPY ${APP}/nurse-app/package*.json nurse-app/
COPY ${APP}/display-app/package*.json display-app/
COPY ${APP}/oversight-dashboard/package*.json oversight-dashboard/
RUN for d in patient-app nurse-app display-app oversight-dashboard; do (cd $d && npm ci --no-audit --no-fund); done
COPY ${APP}/ ./
RUN bash build-web.sh

FROM python:3.13-slim
ARG APP
ENV PYTHONUNBUFFERED=1 HOST=0.0.0.0 PORT=8000 SEENSOONER_WEB_ROOT=/app/web-dist
WORKDIR /app
COPY ${APP}/backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY ${APP}/backend backend
COPY --from=web /app/web-dist web-dist
WORKDIR /app/backend
EXPOSE 8000
CMD ["python", "server.py"]

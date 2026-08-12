#!/usr/bin/with-contenv bashio
export LOG_LEVEL="$(bashio::config 'log_level')"
bashio::log.info "Field Map starting on :8099 (ingress)"
exec python3 -m uvicorn main:app --host 0.0.0.0 --port 8099 --log-level "${LOG_LEVEL}"

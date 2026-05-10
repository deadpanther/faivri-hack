FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Create data directory for SQLite
RUN mkdir -p /data

ENV DATABASE_URL=sqlite+aiosqlite:////data/faivri_hack.db
ENV HACKATHON_MODE=1

# Railway sets PORT dynamically — respect it, default to 8008 for local
EXPOSE 8008

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8008}"]

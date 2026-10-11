# Mythbound co-op server

A tiny relay that lets up to four Mythbound players share a world. One player hosts (their game runs the monsters
and bosses); friends join with a five-letter room code. The server only makes rooms and passes messages.

```sh
npm install
npm start      # listens on $PORT (default 8080): health check at /health, WebSocket at /ws
npm test
```

It is deployed on Render's free plan from `render.yaml` at the repository root. Free services fall asleep after 15
minutes without players and take about a minute to wake up on the next connection.

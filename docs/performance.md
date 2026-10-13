# Performance

Machine-specific measurement of `POST /ingest`; not a general benchmark.
API and Postgres (Docker) share this machine with the load generator.

- CPU: AMD Ryzen 5 5500U with Radeon Graphics (12 logical cores)
- RAM: 5.8 GiB
- OS: Windows_NT 10.0.26200, Node v26.1.0
- Run at: 2026-10-13T09:45:34.944Z
- Command: `npm run loadtest -w apps/api` (10 connections, 10s, 500 events per request)

```
┌─────────┬───────┬───────┬────────┬────────┬──────────┬─────────┬────────┐
│ Stat    │ 2.5%  │ 50%   │ 97.5%  │ 99%    │ Avg      │ Stdev   │ Max    │
├─────────┼───────┼───────┼────────┼────────┼──────────┼─────────┼────────┤
│ Latency │ 57 ms │ 86 ms │ 214 ms │ 236 ms │ 98.92 ms │ 48.5 ms │ 543 ms │
└─────────┴───────┴───────┴────────┴────────┴──────────┴─────────┴────────┘
┌───────────┬───────┬───────┬─────────┬─────────┬─────────┬─────────┬─────────┐
│ Stat      │ 1%    │ 2.5%  │ 50%     │ 97.5%   │ Avg     │ Stdev   │ Min     │
├───────────┼───────┼───────┼─────────┼─────────┼─────────┼─────────┼─────────┤
│ Req/Sec   │ 50    │ 50    │ 103     │ 127     │ 101     │ 24.8    │ 50      │
├───────────┼───────┼───────┼─────────┼─────────┼─────────┼─────────┼─────────┤
│ Bytes/Sec │ 21 kB │ 21 kB │ 43.2 kB │ 53.2 kB │ 42.3 kB │ 10.4 kB │ 20.9 kB │
└───────────┴───────┴───────┴─────────┴─────────┴─────────┴─────────┴─────────┘

Req/Bytes counts sampled once per second.
# of samples: 10

1k requests in 10.1s, 423 kB read
```

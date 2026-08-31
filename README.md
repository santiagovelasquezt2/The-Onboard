# TheOnboard

TheOnboard started with a pretty simple question: what if you could watch an F1 onboard and see the same lap happening in 3D at the same time? Right now it is built around one lap—George Russell's pole lap at the 2024 Canadian Grand Prix. It keeps the onboard video, OpenF1 telemetry, and a 3D version of Circuit Gilles Villeneuve on the same clock, so when you play, pause, or scrub, everything moves together.

The hard part is not putting a car on a track. It is getting video, telemetry, and position data from different sources to agree on exactly where the car should be at any moment, without hiding bad data or making the 3D view lag behind. OpenF1 data is pulled ahead of time into a local replay file, and the app never depends on the API while you are watching the lap.

It is built with Vite, React, TypeScript, Three.js, and React Three Fiber. Run it with `npm install && npm run dev`, then check it with `npm run lint`, `npm test`, and `npm run build`. The onboard video and licensed 3D assets stay local; setup and credits are in [public/media/README.md](public/media/README.md), and the full product scope is in [PRODUCT.md](PRODUCT.md).

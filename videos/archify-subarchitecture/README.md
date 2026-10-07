# Archify Labs walkthrough

The finished video [plays directly in the Labs README](https://github.com/Puuuuup/archify/tree/labs/subarchitecture#try-subarchitecture-in-labs). Its [GitHub video attachment](https://github.com/user-attachments/assets/f0e1f816-261c-41d2-a541-388f962c0a28) is the same encoded MP4 as `docs/labs/subarchitecture.mp4`. It is 1920 × 1080 with English narration and embedded English and Chinese subtitles. The composition lasts 90.615 seconds.

Seven frames cover the overview, inline expansion, independent exports, returning, official BAGEL inference, official Lance queries, and the bounded Labs scope. Frames 2, 3 and 4 use actual browser interaction footage. The remaining frames use actual browser captures. No product UI was reconstructed.

## Render again

Install Node and ffmpeg. From this directory, run the pinned commands.

```sh
npm run check
npm run render -- --quality high --output renders/video.mp4
```

The project ships its narration, screenshots, footage, fonts and GSAP runtime. Rendering does not require a speech account or model download. The preset is Blue Professional. The fonts are Inter, Space Grotesk and a text subset of Noto Sans SC. Their OFL notices are in `assets/fonts`.

`BRIEF.md` records the requested format. `STORYBOARD.md` and `SCRIPT.md` record the visual plan and English narration. `narration.json` pairs each sentence with its Chinese translation. `subtitle-cues.json` records measured sentence boundaries. The WAV for each frame was built from separately synthesized sentences, using [Kokoro ONNX](https://github.com/thewh1teagle/kokoro-onnx) with `am_michael`. Caption timing uses these audio durations, rather than estimated word timestamps.

The optional `kokoro-engine.py` and `.mjs` adapter reproduce narration through the HyperFrames media engine. Set `HYPERFRAMES_PYTHON` to a Python environment with `kokoro-onnx` and `soundfile`. Set `ARCHIFY_VIDEO_MODELS` to a directory containing the official `kokoro-v1.0.onnx` and `voices-v1.0.bin` release files. Model weights are outside this project.

The video was made with the HyperFrames `product-launch-video` workflow. Lint, browser runtime, layout and contrast checks passed before rendering. Motion and scene cuts were reviewed in frame snapshots.

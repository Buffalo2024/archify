"""Local Kokoro adapter with captions timed from separately synthesized cues.

No word alignment is inferred. Each caption boundary is measured from its WAV.
Model files stay outside the published project and are never embedded in a video.
"""
import argparse,json,os
from pathlib import Path
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ap=argparse.ArgumentParser();ap.add_argument('--request');ap.add_argument('--hyperframes');ap.add_argument('--out');ap.add_argument('--only');args,_=ap.parse_known_args()
root=Path(args.hyperframes);request=json.loads(Path(args.request).read_text())
models=Path(os.environ['ARCHIFY_VIDEO_MODELS'])
engine=Kokoro(str(models/'kokoro-v1.0.onnx'),str(models/'voices-v1.0.bin'))
narration={f['id']:f for f in json.loads((root/'narration.json').read_text(encoding='utf-8'))}
voices=[];segments=[]
for line in request['lines']:
    frame=narration[line['id']];samples=[];words=[];start=0
    for english,chinese in frame['cues']:
        audio,rate=engine.create(english,voice='am_michael',speed=1.05,lang='en-us')
        duration=len(audio)/rate
        words.append(dict(id=len(words),text=english,start=round(start,3),end=round(start+duration,3)))
        segments.append(dict(frame=int(line['id']),english=english,chinese=chinese,start=round(start,3),end=round(start+duration,3)))
        samples.extend(audio);samples.extend(np.zeros(int(rate*0.16)));start+=duration+0.16
    target=root/'assets'/'voice'/(line['id']+'.wav');target.parent.mkdir(parents=True,exist_ok=True)
    sf.write(target,np.array(samples),rate)
    voices.append(dict(id=line['id'],path=target.relative_to(root).as_posix(),duration_s=round(len(samples)/rate,3),words=words))
    print(line['id'],round(len(samples)/rate,2),'seconds',flush=True)
Path(args.out).write_text(json.dumps(dict(tts_provider='kokoro',voice_id='am_michael',bgm=None,bgm_pending=False,voices=voices,sfx=[],total_duration_s=sum(v['duration_s'] for v in voices)),indent=2))
(root/'subtitle-cues.json').write_text(json.dumps(segments,ensure_ascii=False,indent=2),encoding='utf-8')

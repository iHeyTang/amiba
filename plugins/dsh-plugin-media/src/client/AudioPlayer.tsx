import { useRef, useState, type CSSProperties } from "react";
import { Play, Pause, Download, Check, Volume2, VolumeX } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger, usePluginT } from "@amiba/ui/plugin";
import { mediaCopy } from "./i18n-media.js";
const time = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
export function AudioPlayer({ url, filename }: { url: string; filename: string }) {
  const { t } = usePluginT(mediaCopy);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  return <div className="amiba-audio">
    <audio ref={audio} src={url} preload="metadata"
      onLoadedMetadata={event => { const n = event.currentTarget.duration; setDuration(Number.isFinite(n) ? n : 0); setError(false); }}
      onDurationChange={event => { const n = event.currentTarget.duration; if (Number.isFinite(n)) setDuration(n); }}
      onTimeUpdate={event => setPosition(event.currentTarget.currentTime)}
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
      onError={() => { setError(true); setPlaying(false); }} />
    <div className="amiba-audio-controls">
      <button type="button" className="amiba-audio-play" aria-label={t(playing ? "media.pause" : "media.play")} onClick={async () => {
        if (!audio.current) return;
        if (playing) audio.current.pause();
        else { try { if (error) audio.current.load(); await audio.current.play(); setError(false); } catch { setError(true); } }
      }}>{playing ? <Pause size={15} strokeWidth={2}/> : <Play size={15} fill="currentColor" strokeWidth={1.5}/>}</button>
      <input style={{ "--audio-progress": `${duration ? Math.min(100, position / duration * 100) : 0}%` } as CSSProperties} type="range" min={0} max={duration || 1} step={0.1} value={position} disabled={!duration} aria-label={t("media.seek")} onChange={event => {
        const value = Number(event.target.value); if (audio.current) audio.current.currentTime = value; setPosition(value);
      }}/>
      <span className="amiba-audio-time"><span>{time(position)}</span><span className="amiba-audio-time-divider">/</span>{time(duration)}</span>
      <Popover open={speedOpen} onOpenChange={setSpeedOpen}>
        <PopoverTrigger asChild><button type="button" className="amiba-audio-speed" aria-label={t("media.speed")}>{speed}×</button></PopoverTrigger>
        <PopoverContent side="top" size="narrow" className="amiba-audio-speeds" aria-label={t("media.speed")}>
          <h3>{t("media.speed")}</h3>
          {[0.75, 1, 1.25, 1.5, 2].map(value => <button type="button" key={value} aria-pressed={speed === value} onClick={() => {
            if (audio.current) audio.current.playbackRate = value; setSpeed(value); setSpeedOpen(false);
          }}><span>{value}×</span>{speed === value && <Check size={14}/>}</button>)}
        </PopoverContent>
      </Popover>
      <button type="button" aria-label={t(muted ? "media.unmute" : "media.mute")} onClick={() => { if (audio.current) audio.current.muted = !muted; setMuted(!muted); }}>{muted ? <VolumeX size={15}/> : <Volume2 size={15}/>}</button>
      <a href={url} download={filename} aria-label={t("media.download")} title={t("media.download")}><Download size={15}/></a>
    </div>
    {error && <p role="alert">{t("media.playError")}</p>}
  </div>;
}

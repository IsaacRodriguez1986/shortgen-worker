import {
  AbsoluteFill,
  Sequence,
  Audio,
  Img,
  Video,
  useVideoConfig,
} from "remotion";
import { Subtitles } from "./Subtitles";

export type Scene = {
  voiceUrl: string;
  visualUrl: string;
  narration: string;
  duration: number; // in seconds
  isVideo?: boolean;
};

export type ShortVideoProps = {
  scenes: Scene[];
  subtitleStyle: string;
  musicUrl?: string;
  musicVolume?: number;
};

export const ShortVideo: React.FC<ShortVideoProps> = ({
  scenes,
  subtitleStyle,
  musicUrl,
  musicVolume = 0.2,
}) => {
  const { fps } = useVideoConfig();

  let currentFrame = 0;

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {scenes.map((scene, i) => {
        const durationInFrames = Math.round(scene.duration * fps);
        const startFrame = currentFrame;
        currentFrame += durationInFrames;

        return (
          <Sequence
            key={i}
            from={startFrame}
            durationInFrames={durationInFrames}
          >
            <AbsoluteFill>
              {/* Visual — video or image */}
              {scene.isVideo ? (
                <Video
                  src={scene.visualUrl}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                  loop
                />
              ) : (
                <Img
                  src={scene.visualUrl}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
              )}

              {/* Voice audio */}
              {scene.voiceUrl && <Audio src={scene.voiceUrl} volume={1} />}

              {/* Subtitles */}
              {scene.narration && (
                <Subtitles
                  text={scene.narration}
                  style={subtitleStyle}
                  durationInFrames={durationInFrames}
                  fps={fps}
                />
              )}
            </AbsoluteFill>
          </Sequence>
        );
      })}

      {/* Background music */}
      {musicUrl && <Audio src={musicUrl} volume={musicVolume} loop />}
    </AbsoluteFill>
  );
};

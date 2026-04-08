import { Composition } from "remotion";
import { ShortVideo } from "./ShortVideo";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="ShortVideo"
      component={ShortVideo}
      durationInFrames={30 * 30} // 30s default at 30fps
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{
        scenes: [],
        subtitleStyle: "hormozi",
      }}
    />
  );
};

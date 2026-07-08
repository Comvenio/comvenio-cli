// Template "slideshow" (K7): gallery slideshow with Ken-Burns zoom/pan, crossfades,
// title intro and per-image text overlays. Duration: intro + n * durationPerImage.
import React from "react";
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { BrandBar, FONT_STACK, FadeInOut, LogoCorner } from "./Branding";
import { SLIDESHOW_INTRO_SECONDS, type SlideshowProps } from "./types";

const CROSSFADE_SECONDS = 0.6;

const TitleIntro: React.FC<{ title: string; subtitle?: string; brandColor: string }> = ({
  title,
  subtitle,
  brandColor,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(135deg, ${brandColor} 0%, #101418 100%)`,
        justifyContent: "center",
        alignItems: "center",
        fontFamily: FONT_STACK,
        color: "#fff",
        textAlign: "center",
        padding: 120,
      }}
    >
      <div style={{ transform: `translateY(${(1 - enter) * 60}px)`, opacity: enter }}>
        <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1.1 }}>{title}</div>
        {subtitle ? (
          <div style={{ fontSize: 44, fontWeight: 500, marginTop: 28, opacity: 0.85 }}>
            {subtitle}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

const KenBurnsImage: React.FC<{
  image: string;
  overlay?: string;
  index: number;
  durationFrames: number;
}> = ({ image, overlay, index, durationFrames }) => {
  const frame = useCurrentFrame();
  // alternate zoom direction/pan per image for visual variety (deterministic by index)
  const zoomIn = index % 2 === 0;
  const scale = interpolate(frame, [0, durationFrames], zoomIn ? [1, 1.09] : [1.09, 1], {
    extrapolateRight: "clamp",
  });
  const panX = interpolate(frame, [0, durationFrames], index % 3 === 0 ? [-14, 14] : [10, -10], {
    extrapolateRight: "clamp",
  });
  const fadeFrames = CROSSFADE_SECONDS * 30;
  const opacity = interpolate(
    frame,
    [0, fadeFrames, durationFrames - fadeFrames, durationFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return (
    <AbsoluteFill style={{ opacity }}>
      <Img
        src={staticFile(image)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale}) translateX(${panX}px)`,
        }}
      />
      {overlay ? (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            padding: "140px 80px 70px",
            background: "linear-gradient(transparent, rgba(0,0,0,0.75))",
            color: "#fff",
            fontFamily: FONT_STACK,
            fontSize: 46,
            fontWeight: 600,
            textShadow: "0 2px 8px rgba(0,0,0,0.5)",
          }}
        >
          {overlay}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

export const Slideshow: React.FC<SlideshowProps> = (props) => {
  const { fps } = useVideoConfig();
  const introFrames = Math.round(SLIDESHOW_INTRO_SECONDS * fps);
  const perImageFrames = Math.round(props.durationPerImage * fps);
  const fadeFrames = Math.round(CROSSFADE_SECONDS * fps);

  return (
    <FadeInOut>
      <Sequence durationInFrames={introFrames + fadeFrames}>
        <TitleIntro title={props.title} subtitle={props.subtitle} brandColor={props.brandColor} />
      </Sequence>
      {props.images.map((image, i) => (
        <Sequence
          key={i}
          from={introFrames + i * perImageFrames - (i > 0 ? fadeFrames : 0)}
          durationInFrames={perImageFrames + fadeFrames}
        >
          <KenBurnsImage
            image={image}
            overlay={props.overlays?.[i]}
            index={i}
            durationFrames={perImageFrames + fadeFrames}
          />
        </Sequence>
      ))}
      <LogoCorner logoFile={props.logoFile} />
      <BrandBar brandColor={props.brandColor} />
    </FadeInOut>
  );
};

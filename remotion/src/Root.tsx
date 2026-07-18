// Composition registry (K7): 3 fixed templates — slideshow, result, teaser.
// Durations are derived from props via calculateMetadata (durationOverride wins).
import React from "react";
import { Composition } from "remotion";
import { ResultBoard } from "./ResultBoard";
import { Slideshow } from "./Slideshow";
import { Teaser } from "./Teaser";
import { Highlight } from "./Highlight";
import {
  HIGHLIGHT_DEFAULT_SECONDS,
  FPS,
  HEIGHT,
  RESULT_DEFAULT_SECONDS,
  TEASER_DEFAULT_SECONDS,
  WIDTH,
  slideshowDurationSeconds,
} from "./types";

const toFrames = (seconds: number) => Math.round(seconds * FPS);

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="slideshow"
        component={Slideshow}
        width={WIDTH}
        height={HEIGHT}
        fps={FPS}
        durationInFrames={toFrames(8)}
        defaultProps={{
          title: "Comvenio Slideshow",
          images: [],
          durationPerImage: 4,
          brandColor: "#0E847B",
        }}
        calculateMetadata={({ props }) => ({
          durationInFrames: toFrames(slideshowDurationSeconds(props)),
        })}
      />
      <Composition
        id="result"
        component={ResultBoard}
        width={WIDTH}
        height={HEIGHT}
        fps={FPS}
        durationInFrames={toFrames(RESULT_DEFAULT_SECONDS)}
        defaultProps={{
          homeTeam: "Heim",
          awayTeam: "Gast",
          homeScore: 0,
          awayScore: 0,
          brandColor: "#0E847B",
        }}
        calculateMetadata={({ props }) => ({
          durationInFrames: toFrames(props.durationOverride ?? RESULT_DEFAULT_SECONDS),
        })}
      />
      <Composition
        id="teaser"
        component={Teaser}
        width={WIDTH}
        height={HEIGHT}
        fps={FPS}
        durationInFrames={toFrames(TEASER_DEFAULT_SECONDS)}
        defaultProps={{
          title: "Comvenio Teaser",
          date: "2026-01-01",
          brandColor: "#0E847B",
        }}
        calculateMetadata={({ props }) => ({
          durationInFrames: toFrames(props.durationOverride ?? TEASER_DEFAULT_SECONDS),
        })}
      />
      <Composition
        id="highlight"
        component={Highlight}
        width={WIDTH}
        height={HEIGHT}
        fps={FPS}
        durationInFrames={toFrames(HIGHLIGHT_DEFAULT_SECONDS)}
        defaultProps={{
          title: "Titel",
          brandColor: "#0E847B",
          items: [],
        }}
        calculateMetadata={({ props }) => ({
          durationInFrames: toFrames(props.durationOverride ?? HIGHLIGHT_DEFAULT_SECONDS),
        })}
      />
    </>
  );
};

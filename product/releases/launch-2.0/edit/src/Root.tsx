import { Composition } from 'remotion';
import { DURATION, DesignIteration, FPS, HEIGHT, WIDTH } from './DesignIteration';

export const Root: React.FC = () => (
  <Composition
    id="DesignIteration"
    component={DesignIteration}
    durationInFrames={DURATION}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
  />
);

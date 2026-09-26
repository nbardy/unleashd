import { Composition } from 'remotion';
import * as DesignIteration from './DesignIteration';
import * as Overload from './Overload';

export const Root: React.FC = () => (
  <>
    <Composition
      id="Overload"
      component={Overload.Overload}
      defaultProps={{ calm: 'epiano' as Overload.Calm }}
      durationInFrames={Overload.DURATION}
      fps={Overload.FPS}
      width={Overload.WIDTH}
      height={Overload.HEIGHT}
    />
    <Composition
      id="DesignIteration"
      component={DesignIteration.DesignIteration}
      durationInFrames={DesignIteration.DURATION}
      fps={DesignIteration.FPS}
      width={DesignIteration.WIDTH}
      height={DesignIteration.HEIGHT}
    />
  </>
);

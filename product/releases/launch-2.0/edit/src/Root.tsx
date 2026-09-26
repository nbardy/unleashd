import { Composition } from 'remotion';
import * as DesignIteration from './DesignIteration';
import * as DesignReview from './DesignReview';
import * as NativeMultimedia from './NativeMultimedia';
import * as Overload from './Overload';

export const Root: React.FC = () => (
  <>
    <Composition
      id="Overload"
      component={Overload.Overload}
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
    <Composition
      id="DesignReview"
      component={DesignReview.DesignReview}
      durationInFrames={DesignReview.DURATION}
      fps={DesignReview.FPS}
      width={DesignReview.WIDTH}
      height={DesignReview.HEIGHT}
    />
    <Composition
      id="NativeMultimedia"
      component={NativeMultimedia.NativeMultimedia}
      durationInFrames={NativeMultimedia.DURATION}
      fps={NativeMultimedia.FPS}
      width={NativeMultimedia.WIDTH}
      height={NativeMultimedia.HEIGHT}
    />
  </>
);

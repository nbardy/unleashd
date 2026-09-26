import type { TurnStatusViewModelOptions } from '../../hooks/useTurnStatusViewModel';
import { TurnStatus } from '../../views/conversation/TurnStatus';

// T20 slice A: the pill is views/conversation/TurnStatus. This delegate exists
// only because ComposerMobile belongs to the composer lane; when that lane lands,
// render <TurnStatus presentation="composer" /> there and delete this file.
export function TurnStatusMobile(props: TurnStatusViewModelOptions) {
  return <TurnStatus {...props} presentation="composer" />;
}

import { SearchView } from '../../views/search/SearchView';
import { MobilePage } from '../components/MobileUI';

/** The Search tab: page chrome around the shared search view (views/search). */
export function SearchMobile() {
  return (
    <MobilePage title="Search" subtitle="Find a conversation or search message history.">
      <SearchView presentation="page" />
    </MobilePage>
  );
}

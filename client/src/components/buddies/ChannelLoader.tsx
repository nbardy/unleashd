import './ChannelLoader.css';

// Shown while a channel or thread has never loaded. Before this the pane
// rendered "No posts yet" during the first fetch and then flashed the posts
// in — an empty channel and an unloaded one looked identical. Desktop and
// mobile share it (gate G3 allows components/buddies/).
export function ChannelLoader({ label }: { label: string }) {
  return (
    <output className="channel-loader" aria-live="polite">
      <svg className="channel-loader-flame" viewBox="0 0 32 44" aria-hidden="true">
        <defs>
          <linearGradient id="channel-loader-outer" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#ff5a1f" />
            <stop offset="0.6" stopColor="#ff9a2e" />
            <stop offset="1" stopColor="#ffcf5c" stopOpacity="0.85" />
          </linearGradient>
          <linearGradient id="channel-loader-inner" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#ffd36b" />
            <stop offset="1" stopColor="#fff4c2" />
          </linearGradient>
        </defs>
        <g className="channel-loader-sway">
          <path
            className="channel-loader-outer"
            fill="url(#channel-loader-outer)"
            d="M16 2c1.5 7 9.5 11.5 11.5 20.5C29.5 32 23.5 42 16 42S2.5 32 4.5 22.5C5.8 16.5 10 14 11 8.5c2.2 3 2.8 5.8 2.6 8.6C15.6 13.2 16.6 8 16 2Z"
          />
          <path
            className="channel-loader-inner"
            fill="url(#channel-loader-inner)"
            d="M16 18c1 4 6 6.5 6 13 0 5.5-2.8 9-6 9s-6-3.5-6-9c0-4.2 2.6-6 3.6-9 .9 1.6 1.2 3 1 4.4C15.8 24.2 16.4 21.4 16 18Z"
          />
        </g>
      </svg>
      <span className="channel-loader-label">{label}</span>
    </output>
  );
}

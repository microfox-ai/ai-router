import dayjs from 'dayjs';

function formatTimeSince(timestamp: number): string {
  const now = Date.now();
  const secondsAgo = Math.floor((now - timestamp) / 1000);

  const intervals = {
    year: 31536000,
    month: 2592000,
    week: 604800,
    day: 86400,
    hour: 3600,
    minute: 60,
    second: 1,
  };

  for (const [unit, seconds] of Object.entries(intervals)) {
    const interval = Math.floor(secondsAgo / seconds);
    if (interval >= 1) {
      return `${interval} ${unit}${interval !== 1 ? 's' : ''} ago`;
    }
  }

  return 'just now';
}

export function processTimeSince(content: string): string {
  return content.replace(/<timesince>(.*?)<\/timesince>/g, (_, timestamp) => {
    const time = isNaN(timestamp as any)
      ? dayjs(timestamp).valueOf()
      : parseInt(timestamp, 10) * 1000;
    if (!isNaN(time)) {
      return formatTimeSince(time);
    }
    return `<i>${timestamp}</i>`;
  });
}

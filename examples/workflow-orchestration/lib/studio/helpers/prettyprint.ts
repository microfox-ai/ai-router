export const numberWithCommas = (x: number | string) => {
  if (!x) return "0";
  const parts: any = x.toString().split(".");
  if (!parts || parts.length < 1) return "0";
  parts[0] = parts[0]?.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
};

export function replaceLast(x: string, y: string, z: string) {
  const pos = x.lastIndexOf(y);
  x = x.substring(0, pos) + z + x.substring(pos + y.length);
  return x;
}

// Captures 0x + 4 characters, then the last 4 characters.
const truncateRegex = /^(0x[a-zA-Z0-9]{4})[a-zA-Z0-9]+([a-zA-Z0-9]{4})$/;

export const prettyEthAddress = (address: string) => {
  if (!address) return "";
  const match = address.match(truncateRegex);
  if (!match) return address;
  return `${match[1]}…${match[2]}`;
};

export const prettyPrintDateAndTime = (date_timestamp: string) => {
  if (!date_timestamp) return "";
  const dt = new Date();
  dt.setTime(parseInt(date_timestamp) * 1000);
  return `${dt.toLocaleDateString()} | ${dt.toLocaleTimeString()}`;
};

export const prettySinceTime = (date_string: string) => {
  if (!date_string) return "";
  const dt = new Date(date_string);
  const seconds = Math.floor(((new Date() as any) - (dt as any)) / 1000);
  let interval = seconds / 86400;
  if (interval > 1) {
    const days = Math.floor(interval);
    return `${days} day${days > 1 ? "s" : ""} ago`;
  }
  interval = seconds / 3600;
  if (interval > 1) {
    const hourse = Math.floor(interval);
    return `${hourse} hour${hourse > 1 ? "s" : ""} ago`;
  }
  interval = seconds / 60;
  if (interval > 1) {
    return `${Math.floor(interval)} minutes ago`;
  }
  return `${Math.floor(seconds)} seconds ago`;
};

export const prettySinceTimeFromMillis = (dt: number) => {
  const seconds = Math.floor(((new Date() as any) - (dt as any)) / 1000);
  let interval = seconds / 86400;
  if (interval > 1) {
    const days = Math.floor(interval);
    return `${days} day${days > 1 ? "s" : ""} ago`;
  }
  interval = seconds / 3600;
  if (interval > 1) {
    const hourse = Math.floor(interval);
    return `${hourse} hour${hourse > 1 ? "s" : ""} ago`;
  }
  interval = seconds / 60;
  if (interval > 1) {
    return `${Math.floor(interval)} minutes ago`;
  }
  return `${Math.floor(seconds)} seconds ago`;
};

export const formatNumberToText = (
  amount: string | number,
  nodecimals = false,
  decimals = 3
) => {
  const out_amount = typeof amount === "string" ? parseFloat(amount) : amount;
  if (nodecimals || decimals === 0)
    return numberWithCommas(out_amount?.toFixed(0));
  return numberWithCommas(parseFloat(out_amount?.toFixed(decimals)));
};

export const formatTextToNumber = (amount: string | number) => {
  if (amount == null) return 0;
  const out_amount = typeof amount === "number" ? amount.toString() : amount;
  return parseFloat(out_amount?.replace(/[^\d.]/g, ""));
};

export const generateUUID = () => {
  let d = new Date().getTime(); //Timestamp
  let d2 =
    (typeof performance !== "undefined" &&
      performance.now &&
      performance.now() * 1000) ||
    0; //Time in microseconds since page-load or 0 if unsupported
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    let r = Math.random() * 16; //random number between 0 and 16
    if (d > 0) {
      //Use timestamp until depleted
      r = (d + r) % 16 | 0;
      d = Math.floor(d / 16);
    } else {
      //Use microseconds since page-load if supported
      r = (d2 + r) % 16 | 0;
      d2 = Math.floor(d2 / 16);
    }
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
};

// a function to print date in Nov 03 format
export const prettyPrintDateInMMMDD = (date: Date) => {
  const month = date.toLocaleString("default", { month: "short" });
  const day = date.getDate();
  return `${month} ${day}`;
};

export const getDateInFormat = (
  pattern: "full" | "dayname" | "mmm" | "daytype" | ""
) => {
  const date = new Date();
  const day = date.getDay();
  const year = date.getFullYear();
  const dayName = date.toLocaleString("default", { weekday: "long" });
  const monthName = date.toLocaleString("default", { month: "long" });
  const monthShortName = date.toLocaleString("default", { month: "short" });
  if (pattern === "full") return `${dayName}, ${day} ${monthName} ${year}`;
  if (pattern === "dayname") return `${dayName}`;
  if (pattern === "mmm") return `${monthShortName} ${date.getDate()}`;
  // check if day is weekday
  const isWeekday = day > 0 && day < 6;
  if (pattern === "daytype") return `${isWeekday ? "weekdays" : "weekends"}`;
  return `${monthName} ${day}`;
};

export const getTimeInFormat = () => {
  const date = new Date();
  // get time in a timezone
  const hours = date.getHours();
  const minutes = date.getMinutes();
  return `${hours}:${minutes} ${date.getHours() >= 12 ? "PM" : "AM"}`;
};

export const prettyPrintDuration = (startTime: string, endTime: string) => {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const diff = end.getTime() - start.getTime();

  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
};

export const convertMinutesToSeconds = (minutes: number): number => {
  return minutes * 60;
};

export const convertSecondsToMinutes = (seconds: number): number => {
  return seconds / 60;
};

export const convertBytes = (
  bytes: number,
  fromUnit: "B" | "KB" | "MB" | "GB" | "TB",
  toUnit: "B" | "KB" | "MB" | "GB" | "TB"
): number => {
  const units = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024,
  };

  const bytesValue = bytes * units[fromUnit];
  return bytesValue / units[toUnit];
};

export const formatNumberToShort = (num: number): string => {
  if (num >= 1000000000) {
    return (num / 1000000000).toFixed(1).replace(/\.0$/, "") + "B";
  }
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  }
  return num + "";
};

export const formatBytesToReadable = (bytes: number): string => {
  if (bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

export const formatNumberToPercentage = (
  num: number,
  decimals: number = 1
): string => {
  return `${(num * 100).toFixed(decimals)}%`;
};

export const formatNumberToCurrency = (
  num: number,
  currency: string = "USD"
): string => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency,
    minimumFractionDigits: 4,
  }).format(num);
};

export const formatNumberToLocale = (
  num: number,
  locale: string = "en-US"
): string => {
  return new Intl.NumberFormat(locale).format(num);
};

export const formatNumberToFixed = (
  num: number,
  decimals: number = 2
): string => {
  return num.toFixed(decimals);
};

export const formatNumberToScientific = (
  num: number,
  decimals: number = 2
): string => {
  return num.toExponential(decimals);
};

export const formatNumberToOrdinal = (num: number): string => {
  const j = num % 10;
  const k = num % 100;
  if (j === 1 && k !== 11) {
    return num + "st";
  }
  if (j === 2 && k !== 12) {
    return num + "nd";
  }
  if (j === 3 && k !== 13) {
    return num + "rd";
  }
  return num + "th";
};

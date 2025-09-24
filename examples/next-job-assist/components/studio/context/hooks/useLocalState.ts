import { useState, useCallback, useRef } from 'react';

export const IS_BROWSER = typeof window !== 'undefined';
export const SUPPORTED = IS_BROWSER && window.localStorage;

type Dispatch<A> = (value: A) => void;
type SetStateAction<S> = S | ((prevState: S) => S);

const useLocalState = <S>(
  key: string,
  defaultValue: S | (() => S),
): [S, Dispatch<SetStateAction<S>>, () => void] => {
  const [value, setValue] = useState<S>(() => {
    const isCallable = (value: unknown): value is () => S =>
      typeof value === 'function';
    const toStore = isCallable(defaultValue) ? defaultValue() : defaultValue;
    if (!SUPPORTED) return toStore;
    const item = window.localStorage.getItem(key);
    try {
      return item ? JSON.parse(item) : toStore;
    } catch (error) {
      return toStore;
    }
  });

  const lastValue = useRef(value);
  lastValue.current = value;

  const setLocalStateValue = useCallback(
    (newValue: SetStateAction<S>) => {
      const isCallable = (value: unknown): value is (prevState: S) => S =>
        typeof value === 'function';
      const toStore = isCallable(newValue)
        ? newValue(lastValue.current)
        : newValue;
      if (SUPPORTED) window.localStorage.setItem(key, JSON.stringify(toStore));
      setValue(toStore);
    },
    [key],
  );

  const reset = useCallback(() => {
    const isCallable = (value: unknown): value is (prevState: S) => S =>
      typeof value === 'function';
    const toStore = isCallable(defaultValue) ? defaultValue() : defaultValue;
    setValue(toStore);
    if (SUPPORTED) window.localStorage.removeItem(key);
  }, [defaultValue, key]);

  return [value, setLocalStateValue, reset];
};

export default useLocalState;

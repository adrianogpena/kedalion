import type { ComponentType } from 'react';

export interface FileRunnerProps {
  project: string;
  path: string;
  value: string;
  onChange(value: string): void;
}

let runner: ComponentType<FileRunnerProps> | undefined;

/** The app gives the Dashboard the Explorer's editor with run actions for `.sql` and `.curl` files. */
export const setFileRunner = (component: ComponentType<FileRunnerProps>) => {
  runner = component;
};

export const getFileRunner = () => runner;

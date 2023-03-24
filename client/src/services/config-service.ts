import { IConfig } from '../types';

export async function getConfig(): Promise<IConfig> {
  const response = await fetch('config.json');
  const config: IConfig = await response.json();
  return config;
}

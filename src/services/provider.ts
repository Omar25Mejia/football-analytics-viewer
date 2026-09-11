import { appConfig } from '../config'
import { apiFootballProvider } from './apiFootballProvider'
import { demoProvider } from './demoProvider'
export const provider = appConfig.dataMode === 'api-football' ? apiFootballProvider : demoProvider

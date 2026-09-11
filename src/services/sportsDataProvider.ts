import type { Fixture, MatchData } from '../types'
export interface SportsDataProvider {
  getDashboard(offset?: number): Promise<Fixture[]>
  refreshFixture(id: string): Promise<Fixture>
  getMatch(id: string): Promise<MatchData>
  search(query: string, offset?: number): Promise<Fixture[]>
}

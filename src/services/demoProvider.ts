import { demoFixtures, demoMatch } from '../data/demo'
import type { SportsDataProvider } from './sportsDataProvider'
export const demoProvider: SportsDataProvider = {
  async getDashboard() { return demoFixtures },
  async refreshFixture(id) { return demoFixtures.find((fixture) => fixture.id === id) ?? demoFixtures[0] },
  async getMatch(id) { return demoMatch(id) },
  async search(query) {
    const value = query.toLowerCase().trim()
    return !value ? demoFixtures : demoFixtures.filter((f) => `${f.home.name} ${f.away.name} ${f.competition.name} ${f.competition.country}`.toLowerCase().includes(value))
  },
}

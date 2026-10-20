import type { AnalyticsQuery, AnalyticsReport } from './analytics.schema.js';

export interface AnalyticsRepository {
  report(query: AnalyticsQuery): Promise<AnalyticsReport>;
}

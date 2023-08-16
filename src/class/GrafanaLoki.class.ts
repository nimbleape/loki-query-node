// Import Third-party Dependencies
import * as httpie from "@myunisoft/httpie";

// Import Internal Dependencies
import * as utils from "../utils.js";
import { LabelResponse, LabelValuesResponse, LokiStreamResult, RawQueryRangeResponse } from "../types.js";
import { NoopLogParser, LogParserLike } from "./LogParser.class.js";

export interface LokiQueryAPIOptions {
  /**
   * @default 100
   */
  limit?: number;
  start?: number | string;
  end?: number | string;
  since?: string;
}

export interface LokiQueryOptions<T> extends LokiQueryAPIOptions {
  parser?: LogParserLike<T>;
}

export interface GrafanaLokiConstructorOptions {
  /**
   * Grafana API Token
   */
  apiToken?: string;
  /**
   * Remote Grafana root API URL
   */
  remoteApiURL: string | URL;
}

export interface LokiLabelsOptions {
  /**
   * The start time for the query as
   * - a nanosecond Unix epoch.
   * - a duration (i.e "2h")
   *
   * Default to 6 hours ago.
   */
  start?: number | string;
  /**
   * The end time for the query as
   * - a nanosecond Unix epoch.
   * - a duration (i.e "2h")
   *
   * Default to now
   */
  end?: number | string;
  /**
   * A duration used to calculate start relative to end. If end is in the future, start is calculated as this duration before now.
   *
   * Any value specified for start supersedes this parameter.
   */
  since?: string;
}

export interface LokiLabelValuesOptions extends LokiLabelsOptions {
  /**
   * A set of log stream selector that selects the streams to match and return label values for <name>.
   *
   * Example: {"app": "myapp", "environment": "dev"}
   */
  query?: string;
}

export interface QueryRangeResponse<T> {
  logs: T[];
  timerange: utils.TimeRange | null;
}

export interface QueryRangeStreamResponse<T> {
  logs: LokiStreamResult<T>[];
  timerange: utils.TimeRange | null;
}

export class GrafanaLoki {
  private apiToken: string;
  private remoteApiURL: URL;

  constructor(options: GrafanaLokiConstructorOptions) {
    const { apiToken, remoteApiURL } = options;

    this.apiToken = apiToken ?? process.env.GRAFANA_API_TOKEN!;
    if (typeof this.apiToken === "undefined") {
      throw new Error("An apiToken must be provided to use the Grafana Loki API");
    }

    this.remoteApiURL = typeof remoteApiURL === "string" ? new URL(remoteApiURL) : remoteApiURL;
  }

  get httpOptions() {
    return {
      headers: {
        authorization: `Bearer ${this.apiToken}`
      }
    };
  }

  #fetchQueryRange(
    logQL: string,
    options: LokiQueryAPIOptions = {}
  ): Promise<httpie.RequestResponse<RawQueryRangeResponse>> {
    const {
      limit = 100
    } = options;

    /**
     * @see https://grafana.com/docs/loki/latest/api/#query-loki-over-a-range-of-time
     */
    const uri = new URL("loki/api/v1/query_range", this.remoteApiURL);
    uri.searchParams.set("query", logQL);
    uri.searchParams.set("limit", limit.toString());
    if (options.start) {
      uri.searchParams.set("start", utils.durationToUnixTimestamp(options.start));
    }
    if (options.end) {
      uri.searchParams.set("end", utils.durationToUnixTimestamp(options.end));
    }
    if (options.since) {
      uri.searchParams.set("since", options.since);
    }

    return httpie.get<RawQueryRangeResponse>(
      uri, this.httpOptions
    );
  }

  async queryRangeStream<T = string>(
    logQL: string,
    options: LokiQueryOptions<T> = {}
  ): Promise<QueryRangeStreamResponse<T>> {
    const { parser = new NoopLogParser<T>() } = options;

    const { data } = await this.#fetchQueryRange(logQL, options);

    return {
      logs: data.data.result.map((result) => {
        return {
          stream: result.stream,
          values: result.values.flatMap(([, log]) => parser.executeOnLogs([log]))
        };
      }),
      timerange: utils.queryRangeStreamTimeRange(data.data.result)
    };
  }

  async queryRange<T = string>(
    logQL: string,
    options: LokiQueryOptions<T> = {}
  ): Promise<QueryRangeResponse<T>> {
    const { parser = new NoopLogParser<T>() } = options;

    const { data } = await this.#fetchQueryRange(logQL, options);

    const inlinedLogs = utils.inlineLogs(data);
    if (inlinedLogs === null) {
      return {
        logs: [], timerange: null
      };
    }

    return {
      logs: parser.executeOnLogs(inlinedLogs.logs),
      timerange: inlinedLogs.timerange
    };
  }

  async labels(options: LokiLabelsOptions = {}): Promise<string[]> {
    const uri = new URL("loki/api/v1/labels", this.remoteApiURL);
    if (options.start) {
      uri.searchParams.set("start", utils.durationToUnixTimestamp(options.start));
    }
    if (options.end) {
      uri.searchParams.set("end", utils.durationToUnixTimestamp(options.end));
    }
    if (options.since) {
      uri.searchParams.set("since", options.since);
    }

    const { data: labels } = await httpie.get<LabelResponse>(
      uri, this.httpOptions
    );

    return labels.data;
  }

  async labelValues(label: string, options: LokiLabelValuesOptions = {}): Promise<string[]> {
    const uri = new URL(`loki/api/v1/label/${label}/values`, this.remoteApiURL);
    if (options.start) {
      uri.searchParams.set("start", utils.durationToUnixTimestamp(options.start));
    }
    if (options.end) {
      uri.searchParams.set("end", utils.durationToUnixTimestamp(options.end));
    }
    if (options.since) {
      uri.searchParams.set("since", options.since);
    }
    if (options.query) {
      uri.searchParams.set("query", options.query);
    }

    const { data: labelValues } = await httpie.get<LabelValuesResponse>(
      uri, this.httpOptions
    );

    return labelValues.data;
  }
}

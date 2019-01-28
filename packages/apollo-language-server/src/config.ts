import * as cosmiconfig from "cosmiconfig";
import { LoaderEntry } from "cosmiconfig";
import TypeScriptLoader from "@endemolshinegroup/cosmiconfig-typescript-loader";
import { resolve, dirname } from "path";
import { readFileSync, existsSync } from "fs";
import { merge } from "lodash/fp";
import {
  ServiceID,
  ServiceSpecifier,
  ClientID,
  StatsWindowSize,
  ServiceIDAndTag
} from "./engine";
import URI from "vscode-uri";

export interface EngineStatsWindow {
  to: number;
  from: number;
}

export const DefaultEngineStatsWindow = {
  to: -0,
  from: -86400 // one day
};

export interface HistoricalEngineStatsWindow extends EngineStatsWindow {}

export type EndpointURI = string;
export interface RemoteServiceConfig {
  name: ServiceID;
  url: EndpointURI;
  headers?: { [key: string]: string };
  skipSSLValidation?: boolean;
}

export interface LocalServiceConfig {
  name: ServiceID;
  localSchemaFile: string;
}

export interface EngineConfig {
  endpoint?: EndpointURI;
  frontend?: EndpointURI;
  readonly apiKey?: string;
}

export const DefaultEngineConfig = {
  endpoint: "https://engine-graphql.apollographql.com/api/graphql",
  frontend: "https://engine.apollographql.com"
};

export const DefaultConfigBase = {
  includes: ["src/**/*.{ts,tsx,js,jsx,graphql}"],
  excludes: ["**/node_modules", "**/__tests__"]
};

export interface ConfigBase {
  includes: string[];
  excludes: string[];
}

export type ClientServiceConfig = RemoteServiceConfig | LocalServiceConfig;

export interface ClientConfigFormat extends ConfigBase {
  // service linking
  service?: ServiceSpecifier | ClientServiceConfig;
  // client identity
  name?: ClientID;
  referenceID?: string;
  version?: string;
  // client schemas
  clientOnlyDirectives?: string[];
  clientSchemaDirectives?: string[];
  addTypename?: boolean;

  tagName?: string;
  // stats window config
  statsWindow?: StatsWindowSize;
}

export const DefaultClientConfig = {
  ...DefaultConfigBase,
  tagName: "gql",
  clientOnlyDirectives: ["connection", "type"],
  clientSchemaDirectives: ["client", "rest"],
  addTypename: true,
  statsWindow: DefaultEngineStatsWindow
};

export interface ServiceConfigFormat extends ConfigBase {
  name?: string;
  endpoint?: Exclude<RemoteServiceConfig, "name">;
  localSchemaFile?: string;
}

export const DefaultServiceConfig = {
  ...DefaultConfigBase,
  endpoint: {
    url: "http://localhost:4000/graphql"
  }
};

export interface ConfigBaseFormat {
  client?: ClientConfigFormat;
  service?: ServiceConfigFormat;
  engine?: EngineConfig;
}

export type ApolloConfigFormat =
  | WithRequired<ConfigBaseFormat, "client">
  | WithRequired<ConfigBaseFormat, "service">;

// config settings
const MODULE_NAME = "apollo";
const defaultSearchPlaces = [
  "package.json",
  `${MODULE_NAME}.config.js`,
  `${MODULE_NAME}.config.ts`
];

// Based on order, a provided config file will take precedence over the defaults
const getSearchPlaces = (configFile?: string) => [
  ...(configFile ? [configFile] : []),
  ...defaultSearchPlaces
];

const loaders = {
  // XXX improve types for config
  ".json": (cosmiconfig as any).loadJson as LoaderEntry,
  ".js": (cosmiconfig as any).loadJs as LoaderEntry,
  ".ts": {
    async: TypeScriptLoader
  }
};

export interface LoadConfigSettings {
  // the current working directory to start looking for the config
  // config loading only works on node so we default to
  // process.cwd()
  configPath?: string;
  configFileName?: string;
  requireConfig?: boolean;
  name?: string;
  type?: "service" | "client";
}

export type ConfigResult<Config> = {
  config: Config;
  filepath: string;
  isEmpty?: boolean;
} | null;

// XXX change => to named functions
// take a config with multiple project types and return
// an array of individual types
export const projectsFromConfig = (
  config: ApolloConfigFormat,
  configURI?: URI
): Array<ClientConfig | ServiceConfig> => {
  const configs = [];
  const { client, service, ...rest } = config;
  // XXX use casting detection
  if (client) configs.push(new ClientConfig(config, configURI));
  if (service) configs.push(new ServiceConfig(config, configURI));
  return configs;
};

export const parseServiceSpecificer = (
  specifier: ServiceSpecifier
): ServiceIDAndTag => {
  const [id, tag] = specifier.split("@").map(x => x.trim());
  // typescript hinting
  return [id, tag];
};

export const getServiceName = (
  config: ApolloConfigFormat
): string | undefined => {
  if (config.service) return config.service.name;
  if (config.client) {
    if (typeof config.client.service === "string") {
      return parseServiceSpecificer(config.client
        .service as ServiceSpecifier)[0];
    }
    return config.client.service && config.client.service.name;
  } else {
    return undefined;
  }
};

export class ApolloConfig {
  public isClient: boolean;
  public isService: boolean;
  public engine: EngineConfig;
  public name?: string;
  public service?: ServiceConfigFormat;
  public client?: ClientConfigFormat;
  private _tag?: string;

  constructor(public rawConfig: ApolloConfigFormat, public configURI?: URI) {
    this.isService = !!rawConfig.service;
    this.isClient = !!rawConfig.client;
    this.engine = rawConfig.engine!;
    this.name = getServiceName(rawConfig);
    this.client = rawConfig.client;
    this.service = rawConfig.service;
  }

  get configDirURI() {
    return this.configURI && this.configURI.fsPath.includes(".js")
      ? URI.parse(dirname(this.configURI.fsPath))
      : this.configURI;
  }

  get projects() {
    return projectsFromConfig(this.rawConfig, this.configURI);
  }

  set tag(tag: string) {
    this._tag = tag;
  }

  get tag(): string {
    if (this._tag) return this._tag;
    let tag: string = "current";
    if (this.client && typeof this.client.service === "string") {
      const specifierTag = parseServiceSpecificer(this.client
        .service as ServiceSpecifier)[1];
      if (specifierTag) tag = specifierTag;
    }
    return tag;
  }

  // this type needs to be an "EveryKeyIsOptionalApolloConfig"
  public setDefaults({ client, engine, service }: any): void {
    const config = merge(this.rawConfig, { client, engine, service });
    this.rawConfig = config;
    this.client = config.client;
    this.service = config.service;
    if (engine) this.engine = config.engine;
  }
}

export class ClientConfig extends ApolloConfig {
  public client!: ClientConfigFormat;
}

export class ServiceConfig extends ApolloConfig {
  public service!: ServiceConfigFormat;
}

export function isClientConfig(config: ApolloConfig): config is ClientConfig {
  return config.isClient;
}

export function isLocalServiceConfig(
  config: ClientServiceConfig
): config is LocalServiceConfig {
  return !!(config as LocalServiceConfig).localSchemaFile;
}

export function isServiceConfig(config: ApolloConfig): config is ServiceConfig {
  return config.isService;
}

const getServiceFromKey = (key: string | undefined): string | undefined => {
  if (key) {
    const [type, service] = key.split(":");
    if (type === "service") return service;
  }
  return;
};

// XXX load .env files automatically
export const loadConfig = async ({
  configPath,
  configFileName,
  requireConfig = false,
  name,
  type
}: LoadConfigSettings): Promise<ApolloConfig> => {
  const explorer = cosmiconfig(MODULE_NAME, {
    searchPlaces: getSearchPlaces(configFileName),
    loaders
  });

  let loadedConfig = (await explorer.search(configPath)) as ConfigResult<
    ApolloConfigFormat
  >;

  if (requireConfig && !loadedConfig) {
    throw new Error(
      `No Apollo config found for project. For more information, please refer to:
      https://bit.ly/2ByILPj`
    );
  }

  // add API to the env
  let engineConfig = {},
    nameFromKey;
  const dotEnvPath = configPath
    ? resolve(configPath, ".env")
    : resolve(process.cwd(), ".env");

  if (existsSync(dotEnvPath)) {
    const env: { [key: string]: string } = require("dotenv").parse(
      readFileSync(dotEnvPath)
    );

    if (env["ENGINE_API_KEY"]) {
      engineConfig = { engine: { apiKey: env["ENGINE_API_KEY"] } };
      nameFromKey = getServiceFromKey(env["ENGINE_API_KEY"]);
    }
  }

  let resolvedName = name || nameFromKey;

  // The CLI passes in a type when loading config. The editor extension
  // does not. So we determine the type of the config here, and use it if
  // the type wasn't explicitly passed in.
  let resolvedType: "client" | "service";
  if (type) {
    resolvedType = type;
    if (
      loadedConfig &&
      loadedConfig.config.client &&
      typeof loadedConfig.config.client.service === "string"
    ) {
      resolvedName = loadedConfig.config.client.service;
    }
  } else if (loadedConfig && loadedConfig.config.client) {
    resolvedType = "client";
    resolvedName =
      typeof loadedConfig.config.client.service === "string"
        ? loadedConfig.config.client.service
        : resolvedName;
  } else if (loadedConfig && loadedConfig.config.service) {
    resolvedType = "service";
  } else {
    throw new Error(
      "Unable to resolve project type. Please add either a client or service config. For more information, please refer to https://bit.ly/2ByILPj"
    );
  }

  // If there's a name passed in (from env/flag), it merges with the config file, to
  // overwrite either the client's service (if a client project), or the service's name.
  // if there's no config file, it uses the `DefaultConfigBase` to fill these in.
  if (!loadedConfig || resolvedName) {
    loadedConfig = {
      isEmpty: false,
      filepath: configPath || process.cwd(),
      config:
        resolvedType === "client"
          ? {
              ...(loadedConfig ? loadedConfig.config : {}),
              client: {
                ...DefaultConfigBase,
                ...(loadedConfig ? loadedConfig.config.client : {}),
                service: resolvedName
              }
            }
          : {
              ...(loadedConfig ? loadedConfig.config : {}),
              service: {
                ...DefaultConfigBase,
                ...(loadedConfig ? loadedConfig.config.service : {}),
                name: resolvedName
              }
            }
    };
  }

  let { config, filepath, isEmpty } = loadedConfig;

  if (isEmpty) {
    throw new Error(
      `Apollo config found at ${filepath} is empty. Please add either a client or service config`
    );
  }

  // selectivly apply defaults when loading the config
  if (config.client) config = merge({ client: DefaultClientConfig }, config);
  if (config.service) config = merge({ service: DefaultServiceConfig }, config);
  if (engineConfig) config = merge(engineConfig, config);

  config = merge({ engine: DefaultEngineConfig }, config);

  return new ApolloConfig(config, URI.file(resolve(filepath)));
};

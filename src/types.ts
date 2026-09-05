export interface Tree {
  /** Short label used in output, e.g. "work". */
  name: string;
  /** Directory this credential domain covers, e.g. "~/code/work". */
  path: string;
  git: { name?: string; email: string };
  /** GPG key id/fingerprint expected to sign commits here, if signing is used. */
  signingKey?: string;
  /** `Host` entry in ~/.ssh/config that this tree's remotes should use. */
  sshAlias?: string;
  /** Account name GitHub should greet over that alias. */
  sshAccount?: string;
  /** GH_CONFIG_DIR holding this tree's gh credentials. */
  ghConfigDir?: string;
  /** Account `gh` should report for that store. */
  ghAccount?: string;
  /** Chrome `--profile-directory` value for links opened from this tree. */
  browserProfile?: string;
  /** Account the browser profile should be signed in as. Defaults to git.email. */
  browserAccount?: string;
  /** Orgs this tree must reach. Trees are also checked against each other's orgs. */
  orgs?: string[];
}

export interface Config {
  trees: Tree[];
}

export type Status = "pass" | "fail" | "warn" | "skip";

export interface Finding {
  tree: string;
  /** Stable id, e.g. "ssh-identity". Lets output be filtered and diffed over time. */
  check: string;
  status: Status;
  /** One line: what is true. */
  detail: string;
  /** For a failure: what to do about it. Absent for passes. */
  remedy?: string;
}

export interface CheckContext {
  config: Config;
  /** Skip every check that makes a network call. */
  offline: boolean;
}

const SecretsManager = require("./SecretsManager");

// Manage configuration and options
// Uses configuration in this order:
//	1. Passed in values to the deploy function
//	2. JSON secret stored in AWS - "fargate-helper" secret
// 	3. Environment variable
// It is also possible to set a default value
class Config {
	static async initialize (options) {
		Config.options = options;
		Config.defaults = JSON.parse(await SecretsManager.get("fargate-helper"));
	}

	static bool (key, defaultValue) {
		return Config.str(key, defaultValue) === "true" || Config.str(key, defaultValue) === true;
	}

	static has (key) {
		return key in Config.options;
	}

	static int (key, defaultValue) {
		return parseInt(Config.str(key, defaultValue));
	}

	static obj(key) {
		return Config.options[key];
	}

	static setRegion() {
		const region = process.env.AWS_DEFAULT_REGION ? process.env.AWS_DEFAULT_REGION : "us-east-1";
		AWS.config.update({ region: region });
	}

	static str(key, defaultValue) {
		if (Config.options[key]) {
			// console.log("OPT " + key + ":" + Config.options[key]);
			return Config.options[key];
		}

		if (Config.defaults[key]) {
			// console.log("SECRETS " + key + ":" + Config.defaults[key]);
			return Config.defaults[key];
		}

		if (process.env[key]) {
			// console.log("ENV " + key + ":" + process.env[key]);
			return process.env[key];
		}

		if (defaultValue) {
			return defaultValue;
		}

		throw new Error("Value must be specified for: " + key + ". Either set as part of options argument or environment variable.");
	}

	static set(key, value) {
		Config.options[key] = value;
	}
}

module.exports = Config;
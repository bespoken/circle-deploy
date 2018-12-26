const AWS = require("aws-sdk");

AWS.config.update({ region: process.env.AWS_DEFAULT_REGION });

class SecretsManager {
	static async get(secretName) {
		var client = new AWS.SecretsManager();
		
		const secret = await client.getSecretValue({SecretId: secretName}).promise();
		console.log("Secret: " + secret.SecretString);
		return secret.SecretString;
	}
}

module.exports = SecretsManager;
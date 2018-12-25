#!/usr/bin/env node
const AWS = require("aws-sdk");

require("dotenv").config();

class Deployer {
	constructor() {

	}

	static async deploy(options) {
		const region = process.env.AWS_DEFAULT_REGION ? process.env.AWS_DEFAULT_REGION : "us-east-1";
		AWS.config.update({ region: region });
		
		await Config.initialize(options);
		const serviceName = Config.str("serviceName");
		
		// Register the task definition first
		const taskDefinition = await ECSManager.registerTaskDefinition();
		const taskDefinitionArn = taskDefinition.taskDefinition.taskDefinitionArn;

		// Create the service if it does not exist - otherwise, update it
		const service = await ECSManager.describeService(serviceName);
		if (service) {
			const service = await ECSManager.updateService(taskDefinitionArn);
		} else {
			const targetGroupResponse = await ALBManager.createTargetGroup();
			console.log("TargetGroupResponse: " + JSON.stringify(targetGroupResponse, null, 2));
			const targetGroupArn = targetGroupResponse.TargetGroups[0].TargetGroupArn;
			const rules = await ALBManager.createRule(targetGroupArn);
			console.log("Rules: " + JSON.stringify(rules, null, 2));
			const service = await ECSManager.createService(targetGroupArn, taskDefinitionArn);
		}
	}

	// Turns process arguments into JSON
	static async run() {
		const options = { env: {} };
		for (let i=2;i<process.argv.length;i+=2) {
			const keyString = process.argv[i];
			const value = process.argv[i+1];
			const key = keyString.slice(2);
			console.log(key + ": " + value);
			if (key == "env") {
				const keyValue = value.split("=");
				const envKey = keyValue[0];
				console.log("EnvKey: " + keyValue);
				options.env[envKey] = keyValue[1];
			} else {
				options[key] = value;
			}
		}
		console.log("Options: " + JSON.stringify(options, null, 2));
		Deployer.deploy(options);
	}
}

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

	static str(key, defaultValue) {
		if (Config.options[key]) {
			console.log("OPT " + key + ":" + Config.options[key]);
			return Config.options[key];
		}

		if (Config.defaults[key]) {
			console.log("SECRETS " + key + ":" + Config.defaults[key]);
			return Config.defaults[key];
		}

		if (process.env[key]) {
			console.log("ENV " + key + ":" + process.env[key]);
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

class ALBManager {	
	static async createRule(targetGroupArn) {
		const client = new AWS.ELBv2();
		const listenerArn = Config.str("listenerArn");
		
		// Need to go through the listener to figure out the highest priority rule
		const listenerResponse = await client.describeRules({ ListenerArn: listenerArn }).promise();
		let highestPriority = 0;
		for (const rule of listenerResponse.Rules) {
			const priority = parseInt(rule.Priority);
			if (priority > highestPriority) {
				highestPriority = priority;
			}
		}
		const hostname = Config.str("serviceName") + ".bespoken.io";
		var params = {
			Actions: [
			   	{
			  		TargetGroupArn: targetGroupArn, 
			  		Type: "forward"
			 	}
			], 
			Conditions: [
				{
			  		Field: "host-header", 
			  		Values: [hostname]
			 	}
			], 
			ListenerArn: listenerArn, 
			Priority: highestPriority + 1,
		};
		const rules = await client.createRule(params).promise();
		return rules;
	}

	static async createTargetGroup() {
		const client = new AWS.ELBv2();
		var params = {
			Name: Config.str("serviceName"),
			HealthCheckEnabled: Config.bool("healthCheckEnabled", true),
			HealthCheckIntervalSeconds: Config.int("healthCheckIntervalSeconds", 30),
			HealthCheckPath: Config.str("healthCheckPath", "/"),
			HealthCheckPort: Config.str("containerPort"),
			HealthCheckProtocol: Config.str("healthCheckProtocol", "HTTP"),
			HealthCheckTimeoutSeconds: Config.int("healthCheckTimeoutSeconds", 5),
			HealthyThresholdCount: Config.int("unhealthyThresholdCount", 3),
			Matcher: {
			  HttpCode: "200"
			},
			Port: Config.int("containerPort"),
			Protocol: "HTTP",
			TargetType: "ip",
			UnhealthyThresholdCount: Config.int("unhealthyThresholdCount", 3),
			VpcId: Config.str("vpcId")
		};
		console.log("TargetGroup: " + JSON.stringify(params, null, 2));
		const targetGroupResponse = await client.createTargetGroup(params).promise();
		return targetGroupResponse;
	}
}

class SecretsManager {
	static async get(secretName) {
		var client = new AWS.SecretsManager();
		
		const secret = await client.getSecretValue({SecretId: secretName}).promise();
		console.log("Secret: " + secret.SecretString);
		return secret.SecretString;
	}
}

class ECSManager {
	static async createService(targetGroupArn, taskDefinitionArn) {
		const serviceInfo = {
			cluster: Config.str("cluster"),
			desiredCount: Config.int("desiredCounted", 1),
			launchType: "FARGATE",
			loadBalancers: [ 
			   { 
				  containerName: Config.str("serviceName"),
				  containerPort: Config.int("containerPort"),
				  targetGroupArn: targetGroupArn,
			   }
			],
			networkConfiguration: { 
			   awsvpcConfiguration: { 
				  securityGroups: [Config.str("securityGroup")],
				  subnets: Config.str("subnets"),
			   }
			},
			serviceName: Config.str("serviceName"),
			taskDefinition: taskDefinitionArn
		}
		const ecs = new AWS.ECS();
		const service = await ecs.createService(serviceInfo).promise();
		return service;
	}

	static async describeService(serviceName) {
		const ecs = new AWS.ECS();
		const servicesResponse = await ecs.describeServices({
			cluster: Config.str("cluster"),
			services: [serviceName]
		}).promise();

		console.log("SERVICE: " + JSON.stringify(servicesResponse, null, 2));
		if (servicesResponse.services.length === 0) {
			return undefined;
		} else {
			return servicesResponse.services[0];
		}
	}

	static async registerTaskDefinition() {
		let taskDefinition = TaskDefinitionBase;
		if (Config.has("taskDefinition")) {
			// Reading in the task definition
			const taskDefinitionString = require("fs").readFileSync(Config.str("taskDefinition"));
			console.log("READING TaskDefinition: " + Config.str("taskDefinition"));
			taskDefinition = JSON.parse(taskDefinitionString);
		} 
		const containerDefinition = taskDefinition.containerDefinitions[0];
		if (Config.has("command")) {
			containerDefinition.command = [Config.str("command")];
		}
		containerDefinition.image = Config.str("image");
		containerDefinition.logConfiguration.options["awslogs-group"] = Config.str("logGroup", "fargate-cluster");
		containerDefinition.logConfiguration.options["awslogs-stream-prefix"] = Config.str("serviceName");
		containerDefinition.name = Config.str("serviceName");
		containerDefinition.portMappings[0].containerPort = Config.int("containerPort");
		containerDefinition.portMappings[0].hostPort = Config.int("containerPort");
		containerDefinition.repositoryCredentials.credentialsParameter = Config.str("dockerHubSecretArn");
		taskDefinition.cpu = Config.str("cpu");
		taskDefinition.family = Config.str("serviceName");
		taskDefinition.memory = Config.str("memory");
		taskDefinition.executionRoleArn = Config.str("roleArn");
		taskDefinition.taskRoleArn = Config.str("roleArn");

		// Set the environment variables for the container
		let env = {};

		// If pass env is set to false, do not use process.env as base for setting environment variables
		if (Config.str("passEnv", "false") === "true") {
			env = process.env;
		}
		
		// Override env variables with ones passed as part of deploy parameters
		if (Config.obj("env")) {
			for (const key in Config.obj("env")) {
				const value = Config.obj("env")[key];
				console.log("OVERRIDE ENV: " + key + ": " + value);
				env[key] = value;
			}
		}

		for (const key in env) {
			containerDefinition.environment.push({
				name: key,
				value: env[key],
			});
		}
		
		// Write out the task definition for reference
		require("fs").writeFileSync("TaskDefinition.out", JSON.stringify(taskDefinition, null, 2));

		const ecs = new AWS.ECS();
		const taskDefinitionResponse = await ecs.registerTaskDefinition(taskDefinition).promise();
		return taskDefinitionResponse;
	}

	static async updateService(taskDefinitionArn) {
		const ecs = new AWS.ECS();
		const params = {
			cluster: Config.str("cluster"),
			service: Config.str("serviceName"), 
			taskDefinition: taskDefinitionArn
		};

		const updateServiceResponse = await ecs.updateService(params).promise();
		return updateServiceResponse;
	}
}

module.exports = Deployer;
Deployer.run().then(() => {
	console.log("DONE");
});

process.on("unhandledRejection", (e) => {
	console.error("UNHANDLED: " + e.stack);
	process.exit(1);
});

const TaskDefinitionBase = {
    containerDefinitions: [{
		entryPoint: [
            "sh",
            "-c"
        ],
		environment: [],
        essential: true,
        image: "IMAGE_NAME",
        logConfiguration: {
            logDriver: "awslogs",
            options: {
                "awslogs-group": "fargate-cluster",
                "awslogs-region": "us-east-1",
                "awslogs-stream-prefix": "SERVICE_NAME"
            }
        },
        name: "SERVICE_NAME",
        portMappings: [{
            containerPort: 3000,
            hostPort: 3000,
            protocol: "tcp"
        }],
        repositoryCredentials: {
			credentialsParameter: "DOCKER_HUB_CREDENTIALS"
		}
	}],
	cpu: "CPU",
    family: "SERVICE_NAME",
    executionRoleArn: "ROLE_ARN",
    memory: "MEMORY",
	networkMode: "awsvpc",
    requiresCompatibilities: [
        "FARGATE"
	],
	taskRoleArn: "ROLE_ARN"
}
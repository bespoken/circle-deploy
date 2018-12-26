const AWS = require("aws-sdk");
const Config = require("./Config.js");

AWS.config.update({ region: process.env.AWS_DEFAULT_REGION });

// Manages interactions with ECS/Fargate
// Allows for creating and deleting services, as well as task definitions
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

	static async deleteService() {
		// First update service desired count to zero
		const ecs = new AWS.ECS();
		const params = {
			cluster: Config.str("cluster"),
			desiredCount: 0,
			service: Config.str("serviceName"), 
		};

		let response = await ecs.updateService(params).promise();

		delete params.desiredCount;
		response = await ecs.deleteService(params).promise();
		return response;
	}

	// Provides information about the named service
	static async describeService(serviceName) {
		const ecs = new AWS.ECS();
		const servicesResponse = await ecs.describeServices({
			cluster: Config.str("cluster"),
			services: [serviceName]
		}).promise();

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
		containerDefinition.command = [Config.str("command")];
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

	// Updates the service, telling it to use the specific task definition
	// This automatically kicks off a re-deploy, that replaces the running service with containers from the new task definition
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

module.exports = ECSManager;
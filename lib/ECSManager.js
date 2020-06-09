const AWS = require("aws-sdk");
const Config = require("./Config.js");
const fs = require("fs");
const path = require("path");
const Util = require("./Util");

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
		const taskDefinition = ECSManager._taskDefinition()
		const containerDefinition = taskDefinition.containerDefinitions[0];

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

	static async runTask(taskDefinitionArn) {
		const taskDefinition = ECSManager._taskDefinition()
		const ecs = new AWS.ECS();
		let launchType
		if (taskDefinition.requiresCompatibilities.includes('EC2')) {
			launchType = 'EC2'
		} else if (taskDefinition.requiresCompatibilities.includes('FARGATE')) {
			launchType = 'FARGATE'
		} else {
			console.error('TaskDefinition requiresCompatibilities must include either EC2 or FARGATE')
			process.exit(1)
		}

		console.log('CLUSTER: ' + Config.str('cluster') + " TASK: " + taskDefinitionArn)
		const runTaskOptions = {
			cluster: Config.str("cluster"),
			taskDefinition: taskDefinitionArn,
			count: 1,
			launchType: launchType,
		}
		
		// Add a network configuration section if the network mode is awsvpc (typically only for fargate tasks)
		if (taskDefinition.networkMode === 'awsvpc') {
			runTaskOptions.networkConfiguration = {
				awsvpcConfiguration: {
					securityGroups: [Config.str("securityGroup")],
					subnets: Config.str("subnets"),
				}
			}
		}
		
		const runTaskResponse = await ecs.runTask(runTaskOptions).promise()
		console.log('RUNTASKRESPONSE: ' + JSON.stringify(runTaskResponse))
	}

	static async stopTask() {
		const ecs = new AWS.ECS();
		const tasks = await ecs.listTasks({
			cluster: Config.str('cluster'),
			family: Config.str('serviceName')
		}).promise()
		console.log('TASKS: ' + JSON.stringify(tasks, null, 2))
		if (tasks.taskArns.length === 0) {
			console.error('No task found for: ' + Config.str('serviceName'))
			process.exit(1)
		} else if (tasks.taskArns.length > 1) {
			console.error('More than one task found for: ' + Config.str('serviceName'))
			process.exit(1)
		} 

		const stopTaskResponse = await ecs.stopTask({
			cluster: Config.str('cluster'),
			task: tasks.taskArns[0]
		}).promise()
		console.log('StopTask: ' + JSON.stringify(stopTaskResponse, null, 2))
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

	// Derives the task definition JSON from baseline file, override file and command-line arguments
	static _taskDefinition() {
		let taskDefinitionFile = path.join(__dirname, "../TaskDefinition.base.json");
		// We can override the template task definition used by this process
		if (Config.has("taskDefinition")) {
			taskDefinitionFile = Config.str("taskDefinition");
		}

		console.log("READING TaskDefinition: " + taskDefinitionFile);
		let taskDefinitionString = fs.readFileSync(taskDefinitionFile, "UTF-8");

		// Find replace values
		taskDefinitionString = Util.substitute(taskDefinitionString, "command", Config.str("command"));
		taskDefinitionString = Util.substitute(taskDefinitionString, "containerPort", Config.str("containerPort", 3000));
		taskDefinitionString = Util.substitute(taskDefinitionString, "cpu", Config.str("cpu", 512));
		taskDefinitionString = Util.substitute(taskDefinitionString, "dockerHubSecretArn", Config.str("dockerHubSecretArn"));
		taskDefinitionString = Util.substitute(taskDefinitionString, "image", Config.str("image"));
		taskDefinitionString = Util.substitute(taskDefinitionString, "logGroup", Config.str("logGroup", "fargate-cluster"));
		taskDefinitionString = Util.substitute(taskDefinitionString, "memory", Config.str("memory", 1024));
		taskDefinitionString = Util.substitute(taskDefinitionString, "roleArn", Config.str("roleArn"));
		taskDefinitionString = Util.substitute(taskDefinitionString, "serviceName", Config.str("serviceName"));

		const taskDefinition = JSON.parse(taskDefinitionString);
		return taskDefinition
	}
}

module.exports = ECSManager;
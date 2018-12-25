# Setup
Install the package:  
`npm install fargate-helper -g`

Set these environment variables - for the AWS SDK that this relies on:
* AWS_ACCESS_KEY_ID
* AWS_SECRET_ACCESS_KEY
* AWS_DEFAULT_REGION - defaults to `us-east-1` if not set

# How It Works
This tool creates or updates a Fargate service, along with the pieces that it needs (ALB, HealthCheck, etc.).

It assumes that an image has been pushed to Docker Hub - it takes the image name and creates a Fargate service around it.

For new services, the script will:
1) Register a task definition
2) Create an ALB target group, with health check
3) Create an ALB rule for the target group - assigned to <SERVICE_NAME>.bespoken.io
4) Create a service

For existing services, the script will:
1) Register a task definition
2) Update the service

# Deployment Configuration
The values for configuring the service will come from three places:
1) Command-line
2) Environment variables
3) AWS Secrets - the "fargate-helper" key

## Command-Line Configuration
For the command-line, values are passed in with the format:  
`--name value`

For values with spaces, they should be passed in as so:  
`--name "my value"`

## Environment Variables
Values can also be set via environment variable

## AWS Secret Configuration
We store certain key default values, such as DockerHub credentials, in defaults in our AWS Secrets.

They can be found under the name "fargate-helper". Values we store there are:
* accountId: The AWS account ID
* albArn: The ARN for the ALB being used for this account
* cluster: The fargate cluster name
* dockerHubSecretArn: The name of the AWS Secret that stores our docker credentials
* listenerArn: The ARN for the ALB listener being used for this account
* roleArn: Used for taskRoleArn and executionRoleArn
* vpcId: The VPC ID used by this configuration - specified when creating the target group on the ALB

The AWS secret values are meant to be one universal defaults for the account

# Important Values
* command: The command to run for the Docker service - needs to be set if not in the Docker image [OPTIONAL]
* containerPort: The port the service should run on [REQUIRED]
* cpu: The CPU allocated for the service, where 1024 is equal to a full CPU [REQUIRED]
* image: The DockerHub image to use for this service [REQUIRED]
* logGroup: The CloudWatch Log Group to use - defaults to `fargate-cluster` [OPTIONAL]
* memory: The amount of memory allocated for the service [REQUIRED]
* passEnv: "true" or "false" - defaults to true. If set to false, will not automatically set pass thru environment variables in the build environment to the container environment [OPTIONAL]
* serviceName: The name of the service [REQUIRED]
* taskDefinition: A file to use as the baseline for the taskDefinition - if not specified, just uses the default that is included in the code [OPTIONAL]

# Container Configuration
Environment variables can also be set inside the running container.

If `--passEnv` is set to true, we take all the environment variables currently set and pass them to the container in the taskDefinition, under environment.

Environment variables in the container can also be set by specifying on the command-line:  
`node deploy.sh --env KEY=VALUE`

This will set the environment variable `key` to `value` inside the container.

# ALB Configuration
By default, we create a target group with rules on our ALB when first creating the service.

The target group will be configured:
* With a health-check that pings the service every thirty seconds, via a GET on /
* With an endpoint of <SERVICE_NAME>.bespoken.io

# Example
To see a sample project that uses this, check out the Utterance Tester:  
https://github.com/bespoken/UtteranceTester

In particular, here is the Circle CI configuration:  
https://github.com/bespoken/UtteranceTester/blob/master/.circleci/config.yml#L32

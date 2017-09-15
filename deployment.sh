echo "Image: $1"
echo "Env: $2"
echo "Branch/Tag: $3"
echo "FIP: $4"
echo "Size: $5"

export SERVICE=$1-$2
echo "Service: $SERVICE"

# Write out environment variables
env > env.out

# install hyper
if [ `uname -s` = 'Darwin' ]
then
	wget https://hyper-install.s3.amazonaws.com/hyper-mac.bin.zip
	unzip hyper-mac.bin.zip
else
	wget https://hyper-install.s3.amazonaws.com/hyper-linux-x86_64.tar.gz 
	tar xzf hyper-linux-x86_64.tar.gz
fi
chmod +x hyper
./hyper --help

# Login to dockerhub and get our stuff
docker login -e $DOCKER_EMAIL -u $DOCKER_USER -p $DOCKER_PASS
docker build -f docker/Dockerfile -t bespoken/$1:$3 .
docker push bespoken/$1:$3

# Configure hyper and deploy
./hyper config --accesskey $HYPER_KEY --secretkey $HYPER_SECRET
./hyper login -e $DOCKER_EMAIL -u $DOCKER_USER -p $DOCKER_PASS
./hyper pull bespoken/$1:$3
./hyper rm -f $SERVICE || true
./hyper run -d \
    --env-file env.out \
    --name $SERVICE \
    --size $5 \
    -P bespoken/$1:$3
./hyper fip attach -f $4 $SERVICE
	  
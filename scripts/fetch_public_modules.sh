#!/bin/sh
set -eu

destination=${1:-.cache/aws-modules}
mkdir -p "$destination"

modules="
acm
alb
autoscaling
batch
cloudfront
cloudwatch
dynamodb-table
ec2-instance
ecr
ecs
efs
eks
elasticache
eventbridge
fsx
iam
kms
lambda
network-firewall
opensearch
rds
redshift
route53
s3-bucket
secrets-manager
security-group
sns
sqs
step-functions
transit-gateway
vpc
"

for module in $modules; do
  if [ ! -d "$destination/$module/.git" ]; then
    git clone --depth 1 --filter=blob:none \
      "https://github.com/terraform-aws-modules/terraform-aws-$module.git" \
      "$destination/$module"
  fi
done

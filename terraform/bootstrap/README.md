# Terraform bootstrap

Creates what must exist before `terraform init` works for any environment: the S3 state
bucket, the DynamoDB lock table and the account-wide GitHub OIDC provider.

```bash
cd terraform/bootstrap
terraform init
terraform apply
```

If these resources already exist in the account, import them first instead of creating
them, then run `terraform apply`:

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
terraform import aws_s3_bucket.state capstone-tf-bucket
terraform import aws_s3_bucket_versioning.state capstone-tf-bucket
terraform import aws_s3_bucket_server_side_encryption_configuration.state capstone-tf-bucket
terraform import aws_s3_bucket_public_access_block.state capstone-tf-bucket
terraform import aws_dynamodb_table.lock terraform-state-lock
terraform import aws_iam_openid_connect_provider.github \
  arn:aws:iam::$ACCOUNT:oidc-provider/token.actions.githubusercontent.com
```

The state file stays local and is git-ignored. It holds no secrets, but keep a copy.

use anyhow::Result;

#[tokio::main]
async fn main() -> Result<()> {
    supaterm_host::sp::run().await
}

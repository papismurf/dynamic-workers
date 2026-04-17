from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment / .env file."""

    # Dynamic Workers orchestrator
    orchestrator_url: str = "http://localhost:8787"

    # Crypto price source (CoinGecko free API — no key needed)
    coingecko_base_url: str = "https://api.coingecko.com/api/v3"

    # Coins to track (comma-separated CoinGecko IDs)
    tracked_coins: str = "bitcoin,ethereum,solana,dogecoin,cardano,polkadot,chainlink,avalanche-2"

    # Price poll interval in seconds
    price_interval: float = 10.0

    # Orchestrator repo context for agent tasks
    github_owner: str = "myorg"
    github_repo: str = "crypto-terminal"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()

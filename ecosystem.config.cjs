module.exports = {
	apps: [
		{
			name: "fonts",
			script: "bun",
			args: "run dev",
			interpreter: "none",
			watch: true,
			ignore_watch: ["node_modules", "logs"],
			env: {
				NODE_ENV: "development",
			},
			log_date_format: "YYYY-MM-DD HH:mm:ss Z",
		},
	],
};

/*
 * Copyright 2013-2019 the original author or authors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package org.springframework.cloud.openfeign;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import feign.Contract;
import feign.Logger;
import feign.RequestInterceptor;
import feign.Retryer;
import feign.codec.Decoder;
import feign.codec.Encoder;
import feign.codec.ErrorDecoder;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * @author Eko Kurniawan Khannedy
 */
@ConfigurationProperties("feign.client")
public class FeignClientProperties {

	private boolean defaultToProperties = true;

	private String defaultConfig = "default";

	private Map<String, FeignClientConfiguration> config = new HashMap<>();

	public boolean isDefaultToProperties() {
		return this.defaultToProperties;
	}

	public void setDefaultToProperties(boolean defaultToProperties) {
		this.defaultToProperties = defaultToProperties;
	}

	public String getDefaultConfig() {
		return this.defaultConfig;
	}

	public void setDefaultConfig(String defaultConfig) {
		this.defaultConfig = defaultConfig;
	}

	public Map<String, FeignClientConfiguration> getConfig() {
		return this.config;
	}

	public void setConfig(Map<String, FeignClientConfiguration> config) {
		this.config = config;
	}

	@Override
	public boolean equals(Object o) {
		if (this == o) {
			return true;
		}
		if (o == null || getClass() != o.getClass()) {
			return false;
		}
		FeignClientProperties that = (FeignClientProperties) o;
		return this.defaultToProperties == that.defaultToProperties
				&& Objects.equals(this.defaultConfig, that.defaultConfig)
				&& Objects.equals(this.config, that.config);
	}

	@Override
	public int hashCode() {
		return Objects.hash(this.defaultToProperties, this.defaultConfig, this.config);
	}

	/**
	 * Feign client configuration.
	 */
	public static class FeignClientConfiguration {
		// Feign 日志级别。默认为 NONE
		private Logger.Level loggerLevel;
		// 请求的连接超时时长，单位：毫秒。默认为 10 * 1000 毫秒
		private Integer connectTimeout;
		// 请求的读取超时时长，单位：毫秒。默认为 60 * 1000 毫秒
		private Integer readTimeout;
		// 重试策略。默认为不重试
		private Class<Retryer> retryer;
		// 错误解码器
		private Class<ErrorDecoder> errorDecoder;
		// 请求拦截器
		private List<Class<RequestInterceptor>> requestInterceptors;
		// 是否对响应状态码为 404 时，进行解码。默认为 false
		private Boolean decode404;
		// 解码器。
		// 为空时，默认创建 SpringDecoder Bean
		private Class<Decoder> decoder;
		// 编码器。默认为 SpringEncoder
		// 为空时，默认创建 SpringEncoder Bean
		private Class<Encoder> encoder;
		// 契约。
		// 为空时，默认创建 SpringMvcContract Bean，提供对 SpringMVC 注解的支持
		private Class<Contract> contract;

		public Logger.Level getLoggerLevel() {
			return this.loggerLevel;
		}

		public void setLoggerLevel(Logger.Level loggerLevel) {
			this.loggerLevel = loggerLevel;
		}

		public Integer getConnectTimeout() {
			return this.connectTimeout;
		}

		public void setConnectTimeout(Integer connectTimeout) {
			this.connectTimeout = connectTimeout;
		}

		public Integer getReadTimeout() {
			return this.readTimeout;
		}

		public void setReadTimeout(Integer readTimeout) {
			this.readTimeout = readTimeout;
		}

		public Class<Retryer> getRetryer() {
			return this.retryer;
		}

		public void setRetryer(Class<Retryer> retryer) {
			this.retryer = retryer;
		}

		public Class<ErrorDecoder> getErrorDecoder() {
			return this.errorDecoder;
		}

		public void setErrorDecoder(Class<ErrorDecoder> errorDecoder) {
			this.errorDecoder = errorDecoder;
		}

		public List<Class<RequestInterceptor>> getRequestInterceptors() {
			return this.requestInterceptors;
		}

		public void setRequestInterceptors(
				List<Class<RequestInterceptor>> requestInterceptors) {
			this.requestInterceptors = requestInterceptors;
		}

		public Boolean getDecode404() {
			return this.decode404;
		}

		public void setDecode404(Boolean decode404) {
			this.decode404 = decode404;
		}

		public Class<Decoder> getDecoder() {
			return this.decoder;
		}

		public void setDecoder(Class<Decoder> decoder) {
			this.decoder = decoder;
		}

		public Class<Encoder> getEncoder() {
			return this.encoder;
		}

		public void setEncoder(Class<Encoder> encoder) {
			this.encoder = encoder;
		}

		public Class<Contract> getContract() {
			return this.contract;
		}

		public void setContract(Class<Contract> contract) {
			this.contract = contract;
		}

		@Override
		public boolean equals(Object o) {
			if (this == o) {
				return true;
			}
			if (o == null || getClass() != o.getClass()) {
				return false;
			}
			FeignClientConfiguration that = (FeignClientConfiguration) o;
			return this.loggerLevel == that.loggerLevel
					&& Objects.equals(this.connectTimeout, that.connectTimeout)
					&& Objects.equals(this.readTimeout, that.readTimeout)
					&& Objects.equals(this.retryer, that.retryer)
					&& Objects.equals(this.errorDecoder, that.errorDecoder)
					&& Objects.equals(this.requestInterceptors, that.requestInterceptors)
					&& Objects.equals(this.decode404, that.decode404)
					&& Objects.equals(this.encoder, that.encoder)
					&& Objects.equals(this.decoder, that.decoder)
					&& Objects.equals(this.contract, that.contract);
		}

		@Override
		public int hashCode() {
			return Objects.hash(this.loggerLevel, this.connectTimeout, this.readTimeout,
					this.retryer, this.errorDecoder, this.requestInterceptors,
					this.decode404, this.encoder, this.decoder, this.contract);
		}

	}

}

package com.example.stomp.controller;

import com.example.stomp.model.ChatMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.handler.annotation.SendTo;
import org.springframework.messaging.simp.annotation.SubscribeMapping;
import org.springframework.stereotype.Controller;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

@Controller
public class StompMessageController {

    private static final Logger log = LoggerFactory.getLogger(StompMessageController.class);

    // Defense & Radar/Signal Topics
    @MessageMapping("/signal")
    @SendTo("/topic/signal")
    public Object handleSignalTelemetry(@Payload Object payload) {
        log.info("Signal Telemetry Broadcast: {}", payload);
        return payload;
    }

    @MessageMapping("/radar")
    @SendTo("/topic/signal")
    public Object handleRadarTrack(@Payload Object payload) {
        log.info("Radar Track Broadcast: {}", payload);
        return payload;
    }

    @MessageMapping("/alert")
    @SendTo("/topic/alert")
    public Object handleTacticalAlert(@Payload Object payload) {
        log.info("Tactical Alert Triggered: {}", payload);
        return payload;
    }

    @MessageMapping("/target")
    @SendTo("/topic/target")
    public Object handleTargetUpdate(@Payload Object payload) {
        log.info("Target Data Update: {}", payload);
        return payload;
    }

    @MessageMapping("/systemstatus")
    @SendTo("/topic/systemstatus")
    public Object handleSystemStatusTelemetry(@Payload Object payload) {
        log.info("System Status Telemetry: {}", payload);
        return payload;
    }

    // Existing compatibility mappings
    @MessageMapping("/chat")
    @SendTo("/topic/messages")
    public ChatMessage handleChatMessage(@Payload ChatMessage message) {
        log.info("Received message from '{}': {}", message.getSender(), message.getContent());
        if (message.getId() == null || message.getId().trim().isEmpty()) {
            message.setId(UUID.randomUUID().toString());
        }
        if (message.getTimestamp() == 0) {
            message.setTimestamp(Instant.now().toEpochMilli());
        }
        return message;
    }

    @MessageMapping("/echo")
    @SendTo("/topic/echo")
    public ChatMessage handleEchoMessage(@Payload ChatMessage message) {
        log.info("Received echo message from '{}': {}", message.getSender(), message.getContent());
        ChatMessage response = new ChatMessage();
        response.setId(UUID.randomUUID().toString());
        response.setSender("Server Echo");
        response.setContent("Echo payload: " + message.getContent());
        response.setType("ECHO_RESPONSE");
        response.setTimestamp(Instant.now().toEpochMilli());
        return response;
    }

    @SubscribeMapping("/topic/welcome")
    public ChatMessage handleWelcomeSubscribe() {
        log.info("Client subscribed to /topic/welcome");
        return new ChatMessage(
            UUID.randomUUID().toString(),
            "Tactical C2 Core",
            "Telemetry stream initialized on /topic/welcome",
            "WELCOME",
            Instant.now().toEpochMilli()
        );
    }
}

package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"connectrpc.com/connect"

	authv1 "poc/goclient/gen/auth/v1"
	"poc/goclient/gen/auth/v1/authv1connect"
)

func main() {
	baseURL := os.Args[1]
	token := strings.TrimSpace(os.Args[2])
	key := os.Getenv("SERVICE_KEY")

	h1 := &http.Client{}
	h2c := &http.Client{Transport: &http.Transport{Protocols: h2cProtocols()}}

	cases := []struct {
		name   string
		client *http.Client
		opts   []connect.ClientOption
	}{
		{"connect-json", h1, []connect.ClientOption{connect.WithProtoJSON()}},
		{"connect-binary", h1, nil},
		{"grpc-web", h1, []connect.ClientOption{connect.WithGRPCWeb()}},
		{"grpc-h2c", h2c, []connect.ClientOption{connect.WithGRPC()}},
	}
	for _, c := range cases {
		auth := authv1connect.NewAuthServiceClient(c.client, baseURL, c.opts...)
		company := authv1connect.NewCompanyServiceClient(c.client, baseURL, c.opts...)

		req := connect.NewRequest(&authv1.VerifySessionRequest{SessionToken: token})
		req.Header().Set("X-Service-Key", key)
		res, err := auth.VerifySession(context.Background(), req)
		if err != nil {
			fmt.Printf("%s VerifySession ERR %v\n", c.name, err)
			continue
		}
		switch o := res.Msg.Outcome.(type) {
		case *authv1.VerifySessionResponse_Ok:
			fmt.Printf("%s VerifySession OK user=%s session=%s\n", c.name, o.Ok.User.Email, o.Ok.Session.Id)
		case *authv1.VerifySessionResponse_Error:
			fmt.Printf("%s VerifySession REJECTED %s\n", c.name, o.Error.Reason)
		}

		creq := connect.NewRequest(&authv1.CheckMembershipsRequest{CompanyId: "no-such-company", UserIds: []string{"u1"}})
		creq.Header().Set("X-Service-Key", key)
		cres, err := company.CheckMemberships(context.Background(), creq)
		if err != nil {
			fmt.Printf("%s CheckMemberships ERR %v\n", c.name, err)
			continue
		}
		fmt.Printf("%s CheckMemberships companyActive=%v members=%v\n", c.name, cres.Msg.CompanyActive, cres.Msg.MemberUserIds)

		bad := connect.NewRequest(&authv1.CheckMembershipsRequest{CompanyId: "", UserIds: []string{"u1"}})
		bad.Header().Set("X-Service-Key", key)
		_, err = company.CheckMemberships(context.Background(), bad)
		fmt.Printf("%s CheckMemberships(invalid) code=%v\n", c.name, connect.CodeOf(err))

		nokey := connect.NewRequest(&authv1.VerifySessionRequest{SessionToken: token})
		_, err = auth.VerifySession(context.Background(), nokey)
		fmt.Printf("%s VerifySession(no key) code=%v\n", c.name, connect.CodeOf(err))
	}

	wrong := connect.NewRequest(&authv1.VerifySessionRequest{SessionToken: "x"})
	wrong.Header().Set("X-Service-Key", key)
	if res, err := authv1connect.NewAuthServiceClient(h1, baseURL).VerifySession(context.Background(), wrong); err == nil {
		fmt.Printf("misread-as-ok email=%q ok-nil=%v\n", res.Msg.GetOk().GetUser().GetEmail(), res.Msg.GetOk() == nil)
	}

	body := fmt.Sprintf(`{"sessionToken":%q}`, token)
	r, _ := http.NewRequest("POST", baseURL+"/auth.v1.AuthService/VerifySession", bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Service-Key", key)
	resp, err := h1.Do(r)
	if err != nil {
		fmt.Printf("raw-net/http ERR %v\n", err)
		return
	}
	b, _ := io.ReadAll(resp.Body)
	fmt.Printf("raw-net/http status=%d body=%.120s\n", resp.StatusCode, b)
}

func h2cProtocols() *http.Protocols {
	p := new(http.Protocols)
	p.SetUnencryptedHTTP2(true)
	return p
}

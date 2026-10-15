package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"

	"poc/goopenapi/gen/consumer"
)

func main() {
	baseURL := os.Args[1]
	token := strings.TrimSpace(os.Args[2])
	withKey := consumer.WithRequestEditorFn(func(_ context.Context, r *http.Request) error {
		r.Header.Set("X-Service-Key", os.Getenv("SERVICE_KEY"))
		return nil
	})
	client, _ := consumer.NewClientWithResponses(baseURL, withKey)
	ctx := context.Background()

	for _, t := range []string{token, "x"} {
		res, err := client.ConsumerVerifySessionWithResponse(ctx, consumer.ConsumerVerifySessionJSONRequestBody{SessionToken: t})
		if err != nil || res.JSON200 == nil {
			fmt.Printf("VerifySession ERR status=%d err=%v\n", res.StatusCode(), err)
			continue
		}
		verified, err := res.JSON200.AsConsumerVerifySession200JSONResponseBody0()
		fmt.Printf("VerifySession As(Verified) err=%v tag=%q email=%q\n", err, verified.UnderscoreTag, verified.User.Email)
		rejected, err := res.JSON200.AsConsumerVerifySession200JSONResponseBody1()
		fmt.Printf("VerifySession As(Rejected) err=%v tag=%q reason=%q\n", err, rejected.UnderscoreTag, rejected.Reason)
	}

	cres, err := client.ConsumerCheckMembershipsWithResponse(ctx, consumer.ConsumerCheckMembershipsJSONRequestBody{CompanyId: "no-such-company", UserIds: []string{"u1"}})
	fmt.Printf("CheckMemberships err=%v status=%d body=%+v\n", err, cres.StatusCode(), cres.JSON200)
	bad, _ := client.ConsumerCheckMembershipsWithResponse(ctx, consumer.ConsumerCheckMembershipsJSONRequestBody{CompanyId: "", UserIds: []string{"u1"}})
	fmt.Printf("CheckMemberships(invalid) status=%d\n", bad.StatusCode())
	nokey, _ := consumer.NewClientWithResponses(baseURL)
	nk, _ := nokey.ConsumerVerifySessionWithResponse(ctx, consumer.ConsumerVerifySessionJSONRequestBody{SessionToken: token})
	fmt.Printf("VerifySession(no key) status=%d 401=%+v\n", nk.StatusCode(), nk.JSON401)
}
